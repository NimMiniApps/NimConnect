package main

import (
	"encoding/json"
	"os"
	"sort"
	"sync"
)

type HandleClaim struct {
	Handle      string `json:"handle"`
	Address     string `json:"address"`
	TxHash      string `json:"tx_hash"`
	BlockHeight uint64 `json:"block_height"`
	TxIndex     uint64 `json:"tx_index"`
}

// HandleRegistry maps handle -> winning claim. The whole map is recomputed
// from the registry address's tx history on every sweep (Rebuild), so ordering
// mistakes and reorgs self-heal; the JSON file is only a warm-start cache.
type HandleRegistry struct {
	path     string
	reserved map[string]bool
	mu       sync.RWMutex
	handles  map[string]HandleClaim
}

func NewHandleRegistry(path string, reserved map[string]bool) *HandleRegistry {
	r := &HandleRegistry{path: path, reserved: reserved, handles: map[string]HandleClaim{}}
	if data, err := readFileIfExists(path); err == nil && data != nil {
		var stored map[string]HandleClaim
		if json.Unmarshal(data, &stored) == nil && stored != nil {
			r.handles = stored
		}
	}
	return r
}

// Rebuild replaces the registry from the registry address's full inbound tx
// list, applying claims and releases in chain order.
// ponytail: full-history rebuild each sweep; switch to cursor-paged
// incremental sync when the registry address accumulates >~10k txs.
func (r *HandleRegistry) Rebuild(txs []rpcTx) error {
	ordered := make([]rpcTx, len(txs))
	copy(ordered, txs)
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].BlockNumber != ordered[j].BlockNumber {
			return ordered[i].BlockNumber < ordered[j].BlockNumber
		}
		return ordered[i].TransactionIndex < ordered[j].TransactionIndex
	})

	next := map[string]HandleClaim{}
	for _, tx := range ordered {
		action := parseClaimData(tx.data())
		if action == nil || r.reserved[action.Handle] {
			continue
		}
		switch action.Verb {
		case "claim":
			if _, taken := next[action.Handle]; !taken {
				next[action.Handle] = HandleClaim{
					Handle:      action.Handle,
					Address:     normalizeAddress(tx.sender()),
					TxHash:      tx.Hash,
					BlockHeight: tx.BlockNumber,
					TxIndex:     tx.TransactionIndex,
				}
			}
		case "release":
			if owner, taken := next[action.Handle]; taken &&
				compactAddress(owner.Address) == compactAddress(tx.sender()) {
				delete(next, action.Handle)
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
