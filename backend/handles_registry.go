package main

import (
	"database/sql"
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
// mistakes and reorgs self-heal; handle_claims in Postgres is only a warm-start cache.
type HandleRegistry struct {
	db                      *sql.DB
	reserved                map[string]bool
	HTLCCreator             func(address string) string
	releaseActivationHeight uint64
	mu                      sync.RWMutex
	handles                 map[string]HandleClaim
}

func NewHandleRegistry(db *sql.DB, reserved map[string]bool, releaseActivationHeight uint64) *HandleRegistry {
	r := &HandleRegistry{
		db:                      db,
		reserved:                reserved,
		releaseActivationHeight: releaseActivationHeight,
		handles:                 map[string]HandleClaim{},
	}
	_ = r.loadFromDB()
	return r
}

func (r *HandleRegistry) loadFromDB() error {
	rows, err := r.db.Query(`
		SELECT handle, address, tx_hash, block_height, tx_index, claimed_at
		FROM handle_claims`)
	if err != nil {
		return err
	}
	defer rows.Close()

	handles := map[string]HandleClaim{}
	for rows.Next() {
		var claim HandleClaim
		var blockHeight, txIndex int64
		if err := rows.Scan(&claim.Handle, &claim.Address, &claim.TxHash, &blockHeight, &txIndex, &claim.ClaimedAt); err != nil {
			return err
		}
		claim.BlockHeight = uint64(blockHeight)
		claim.TxIndex = uint64(txIndex)
		claim.Address = normalizeAddress(claim.Address)
		handles[claim.Handle] = claim
	}
	if err := rows.Err(); err != nil {
		return err
	}

	r.mu.Lock()
	r.handles = handles
	r.mu.Unlock()
	return nil
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
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`TRUNCATE handle_claims`); err != nil {
		return err
	}

	if len(handles) > 0 {
		stmt, err := tx.Prepare(`
			INSERT INTO handle_claims (handle, address, tx_hash, block_height, tx_index, claimed_at)
			VALUES ($1, $2, $3, $4, $5, $6)`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		for _, claim := range handles {
			if _, err := stmt.Exec(
				claim.Handle,
				compactAddress(claim.Address),
				claim.TxHash,
				int64(claim.BlockHeight),
				int64(claim.TxIndex),
				claim.ClaimedAt,
			); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

// PurgeHandles truncates handle_claims and clears the in-memory map.
func (r *HandleRegistry) PurgeHandles() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.db.Exec(`TRUNCATE handle_claims`); err != nil {
		return err
	}
	r.handles = map[string]HandleClaim{}
	return nil
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
