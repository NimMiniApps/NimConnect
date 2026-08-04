package main

import (
	"fmt"
	"log"
	"sync"
	"time"
)

const sweepCooldown = 5 * time.Second

// Pagination knobs for registry sweeps (overridable in tests).
var (
	sweepTxPageSize = 500
	sweepTxMaxPages = 100
)

// HandleSyncer keeps the registry in sync with the chain: a periodic full
// sweep plus rate-limited on-demand sweeps after claim submissions. It also
// resolves HTLC contract senders to their creating wallet so claims are
// attributed to the user, not the swap contract.
type HandleSyncer struct {
	rpc             *NimiqRPC
	registry        *HandleRegistry
	registryAddress string
	mu              sync.Mutex
	lastSweep       time.Time
	complete        bool
	creatorMu       sync.Mutex
	creators        map[string]string
}

func NewHandleSyncer(rpc *NimiqRPC, registry *HandleRegistry, registryAddress string) *HandleSyncer {
	s := &HandleSyncer{
		rpc: rpc, registry: registry, registryAddress: registryAddress,
		creators: map[string]string{},
	}
	registry.HTLCCreator = s.htlcCreator
	return s
}

// Complete reports whether the last successful sweep proved full history
// coverage. Payment resolution must fail closed when this is false (SEC-004).
func (s *HandleSyncer) Complete() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.complete
}

// htlcCreator resolves an HTLC contract address to the wallet that created
// (funded) it — the address the Nimiq Pay user actually owns. Live contracts
// carry their sender in account state; emptied/pruned ones fall back to the
// permanent tx history (the creation tx has toType 2). Results are cached
// for the process lifetime; failures are not cached so they retry next sweep.
func (s *HandleSyncer) htlcCreator(address string) string {
	key := compactAddress(address)
	s.creatorMu.Lock()
	creator, ok := s.creators[key]
	s.creatorMu.Unlock()
	if ok {
		return creator
	}

	resolved := ""
	if acc, err := s.rpc.GetAccountByAddress(address); err == nil && acc.Type == "htlc" && acc.Sender != "" {
		resolved = normalizeAddress(acc.Sender)
	}
	if resolved == "" {
		if txs, err := s.rpc.GetTransactionsByAddress(address, 100); err == nil {
			for _, tx := range txs {
				if tx.ToType == htlcContractType && compactAddress(tx.recipient()) == key {
					// Use the owner embedded in the creation DATA, not the
					// funding tx's sender: Pay rotates HTLCs every ~2 weeks
					// and funds the new contract from the old one, so the
					// sender can be the previous HTLC rather than the user.
					resolved = htlcOwnerFromCreationData(tx.data())
					break
				}
			}
		}
	}

	if resolved != "" {
		s.creatorMu.Lock()
		s.creators[key] = resolved
		s.creatorMu.Unlock()
	}
	return resolved
}

// registryOrderingAmbiguous is true when two or more claim/release actions
// share a block and any of them lacks transactionIndex (SEC-004).
func registryOrderingAmbiguous(txs []rpcTx) bool {
	byBlock := map[uint64][]rpcTx{}
	for _, tx := range txs {
		if parseClaimData(tx.data()) == nil {
			continue
		}
		byBlock[tx.BlockNumber] = append(byBlock[tx.BlockNumber], tx)
	}
	for _, group := range byBlock {
		if len(group) < 2 {
			continue
		}
		for _, tx := range group {
			if tx.TransactionIndex == nil {
				return true
			}
		}
	}
	return false
}

// Sweep refetches the registry address's full tx history and rebuilds the
// registry only when completeness and intra-block ordering are provable.
// No-ops silently when called again within the cooldown window.
func (s *HandleSyncer) Sweep() error {
	return s.sweep(false)
}

// ForceSweep runs a sweep immediately, bypassing the cooldown window.
func (s *HandleSyncer) ForceSweep() error {
	return s.sweep(true)
}

func (s *HandleSyncer) sweep(force bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !force && time.Since(s.lastSweep) < sweepCooldown {
		return nil
	}
	hist, err := s.rpc.GetAllTransactionsByAddress(s.registryAddress, sweepTxPageSize, sweepTxMaxPages)
	if err != nil {
		s.complete = false
		return err
	}
	if !hist.Complete {
		s.complete = false
		return fmt.Errorf("registry history incomplete: hit pagination ceiling without a short page")
	}
	inbound := make([]rpcTx, 0, len(hist.Txs))
	for _, tx := range hist.Txs {
		if compactAddress(tx.recipient()) == compactAddress(s.registryAddress) {
			inbound = append(inbound, tx)
		}
	}
	if registryOrderingAmbiguous(inbound) {
		s.complete = false
		return fmt.Errorf("registry history ordering ambiguous: missing transactionIndex in a shared block")
	}
	if err := s.registry.Rebuild(inbound); err != nil {
		s.complete = false
		return err
	}
	s.complete = true
	s.lastSweep = time.Now()
	return nil
}

// Run sweeps on a fixed interval until stop closes. Start as a goroutine.
func (s *HandleSyncer) Run(interval time.Duration, stop <-chan struct{}) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if err := s.Sweep(); err != nil {
			log.Printf("handle sync sweep failed err=%q", err)
		}
		select {
		case <-ticker.C:
		case <-stop:
			return
		}
	}
}
