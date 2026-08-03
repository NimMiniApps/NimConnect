package main

import (
	"encoding/json"
	"os"
	"sort"
	"sync"
	"time"
)

type HandleClaim struct {
	Handle      string `json:"handle"`
	Address     string `json:"address"`
	TxHash      string `json:"tx_hash"`
	BlockHeight uint64 `json:"block_height"`
	TxIndex     uint64 `json:"tx_index"`
	ClaimedAt   int64  `json:"claimed_at,omitempty"`
}

type HandleStats struct {
	UniqueHandles int
	Days          map[string]int
}

// HandleRegistry maps handle -> winning claim. The whole map is recomputed
// from the registry address's tx history on every sweep (Rebuild), so ordering
// mistakes and reorgs self-heal; the JSON file is only a warm-start cache.
type HandleRegistry struct {
	path     string
	reserved map[string]bool
	// HTLCCreator resolves an HTLC contract address to the account that
	// created it (set by the syncer; nil = attribute to the raw sender).
	HTLCCreator             func(address string) string
	releaseActivationHeight uint64
	mu                      sync.RWMutex
	handles                 map[string]HandleClaim
}

func NewHandleRegistry(path string, reserved map[string]bool, releaseActivationHeight uint64) *HandleRegistry {
	r := &HandleRegistry{
		path:                    path,
		reserved:                reserved,
		releaseActivationHeight: releaseActivationHeight,
		handles:                 map[string]HandleClaim{},
	}
	if data, err := readFileIfExists(path); err == nil && data != nil {
		var stored map[string]HandleClaim
		if json.Unmarshal(data, &stored) == nil && stored != nil {
			r.handles = stored
		}
	}
	return r
}

// Rebuild replaces the registry from the registry address's full inbound tx
// list, applying claims and releases in chain order: a claim assigns a handle
// only when it is currently unowned; a release frees it only when sent by the
// currently resolved owner, and only at or after releaseActivationHeight.
// Releases before that height remain unknown data, preventing existing
// transactions from being retroactively reinterpreted. Resolution follows the
// chain unfiltered — the reserved list only gates NimConnect's claim UI.
// ponytail: full-history rebuild each sweep; the NimFeed catalog address also
// carries posts/follows, so switch to cursor-paged incremental sync once the
// sweep gets slow (>~10k txs).
func (r *HandleRegistry) Rebuild(txs []rpcTx) error {
	ordered := make([]rpcTx, len(txs))
	copy(ordered, txs)
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].BlockNumber != ordered[j].BlockNumber {
			return ordered[i].BlockNumber < ordered[j].BlockNumber
		}
		return ordered[i].txIndexOrZero() < ordered[j].txIndexOrZero()
	})

	next := map[string]HandleClaim{}
	for _, tx := range ordered {
		action := parseClaimData(tx.data())
		if action == nil {
			continue
		}
		signer := normalizeAddress(claimantAddress(tx, r.HTLCCreator))

		if action.IsRelease {
			if tx.BlockNumber < r.releaseActivationHeight {
				continue
			}
			if owner, taken := next[action.Handle]; taken && compactAddress(owner.Address) == compactAddress(signer) {
				delete(next, action.Handle)
			}
			continue
		}

		if _, taken := next[action.Handle]; !taken {
			next[action.Handle] = HandleClaim{
				Handle:      action.Handle,
				Address:     signer,
				TxHash:      tx.Hash,
				BlockHeight: tx.BlockNumber,
				TxIndex:     tx.txIndexOrZero(),
				ClaimedAt:   tx.Timestamp,
			}
		}
	}

	r.mu.Lock()
	r.handles = next
	r.mu.Unlock()
	return r.persist(next)
}

func (r *HandleRegistry) persist(handles map[string]HandleClaim) error {
	data, err := json.Marshal(handles)
	if err != nil {
		return err
	}
	tmp := r.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, r.path)
}

func (r *HandleRegistry) Resolve(handle string) (HandleClaim, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	claim, ok := r.handles[handle]
	return claim, ok
}

func (r *HandleRegistry) Stats() HandleStats {
	r.mu.RLock()
	defer r.mu.RUnlock()

	stats := HandleStats{
		UniqueHandles: len(r.handles),
		Days:          map[string]int{},
	}
	for _, claim := range r.handles {
		if claim.ClaimedAt <= 0 {
			continue
		}
		day := time.UnixMilli(claim.ClaimedAt).UTC().Format("2006-01-02")
		stats.Days[day]++
	}
	return stats
}

func (r *HandleRegistry) Claims() []HandleClaim {
	r.mu.RLock()
	defer r.mu.RUnlock()

	claims := make([]HandleClaim, 0, len(r.handles))
	for _, claim := range r.handles {
		claims = append(claims, claim)
	}
	sort.Slice(claims, func(i, j int) bool {
		return claims[i].Handle < claims[j].Handle
	})
	return claims
}

// Available reports whether a handle could be claimed and, when not, why:
// "invalid", "reserved", "taken". Advisory only — the chain decides.
func (r *HandleRegistry) Available(handle string) (bool, string) {
	if !isValidHandle(handle) {
		return false, "invalid"
	}
	if r.reserved[handle] {
		return false, "reserved"
	}
	if _, taken := r.Resolve(handle); taken {
		return false, "taken"
	}
	return true, ""
}

// ResolveAddress finds the handle owned by an address. An address can end up
// with more than one claim on chain (nothing prevents sending multiple claim
// txs), so this must pick deterministically — earliest (block, txIndex)
// wins, same rule as handle-vs-handle collisions in Rebuild. Do not iterate
// r.handles and return the first hit: Go randomizes map iteration order, so
// that would return a different handle on every call once an address has 2+
// claims.
// ponytail: O(n) scan; index it if the registry ever holds >~50k handles.
func (r *HandleRegistry) ResolveAddress(address string) (HandleClaim, bool) {
	compact := compactAddress(address)
	r.mu.RLock()
	defer r.mu.RUnlock()
	best, found := HandleClaim{}, false
	for _, claim := range r.handles {
		if compactAddress(claim.Address) != compact {
			continue
		}
		if !found || claim.BlockHeight < best.BlockHeight ||
			(claim.BlockHeight == best.BlockHeight && claim.TxIndex < best.TxIndex) {
			best, found = claim, true
		}
	}
	return best, found
}
