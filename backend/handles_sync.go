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
// sweep plus rate-limited on-demand sweeps after claim submissions.
type HandleSyncer struct {
	rpc             *NimiqRPC
	registry        *HandleRegistry
	registryAddress string
	mu              sync.Mutex
	lastSweep       time.Time
}

func NewHandleSyncer(rpc *NimiqRPC, registry *HandleRegistry, registryAddress string) *HandleSyncer {
	return &HandleSyncer{rpc: rpc, registry: registry, registryAddress: registryAddress}
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
