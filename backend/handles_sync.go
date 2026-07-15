package main

import (
	"log"
	"sync"
	"time"
)

const (
	sweepCooldown   = 5 * time.Second
	sweepMaxTxFetch = 5000
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
					resolved = normalizeAddress(tx.sender())
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

// Sweep refetches the registry address's tx history and rebuilds the registry.
// No-ops silently when called again within the cooldown window.
func (s *HandleSyncer) Sweep() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Since(s.lastSweep) < sweepCooldown {
		return nil
	}
	txs, err := s.rpc.GetTransactionsByAddress(s.registryAddress, sweepMaxTxFetch)
	if err != nil {
		return err
	}
	s.lastSweep = time.Now()
	inbound := txs[:0]
	for _, tx := range txs {
		if compactAddress(tx.recipient()) == compactAddress(s.registryAddress) {
			inbound = append(inbound, tx)
		}
	}
	return s.registry.Rebuild(inbound)
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
