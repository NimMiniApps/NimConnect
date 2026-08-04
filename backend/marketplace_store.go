package main

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// MarketplaceStore persists listings, trades, and consumed nonces in Postgres.
type MarketplaceStore struct {
	db *sql.DB
}

func NewMarketplaceStore(db *sql.DB) *MarketplaceStore {
	return &MarketplaceStore{db: db}
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

const tradeSelectCols = `id, reference, handle, buyer, seller, price_luna, fee_luna,
	escrow_address, state, version, deposit_tx_hash, deposit_block_height,
	release_tx_hash, claim_tx_hash, payout_attempted_at, payout_tx_hash,
	refund_attempted_at, refund_tx_hash, deposit_deadline, created_at, updated_at`

func scanTrade(row interface{ Scan(...any) error }) (MarketplaceTrade, error) {
	var t MarketplaceTrade
	var state string
	err := row.Scan(
		&t.ID, &t.Reference, &t.Handle, &t.Buyer, &t.Seller,
		&t.PriceLuna, &t.FeeLuna, &t.EscrowAddress, &state, &t.Version,
		&t.DepositTxHash, &t.DepositBlockHeight, &t.ReleaseTxHash, &t.ClaimTxHash,
		&t.PayoutAttemptedAt, &t.PayoutTxHash, &t.RefundAttemptedAt, &t.RefundTxHash,
		&t.DepositDeadline, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return MarketplaceTrade{}, err
	}
	t.State = TradeState(state)
	return t, nil
}

func scanListing(row interface{ Scan(...any) error }) (MarketplaceListing, error) {
	var l MarketplaceListing
	err := row.Scan(
		&l.Handle, &l.Seller, &l.PriceLuna, &l.FeeLuna, &l.Status,
		&l.OwnershipEpochTxHash, &l.CreatedAt,
	)
	return l, err
}

func (s *MarketplaceStore) getTradeTx(tx *sql.Tx, tradeID string, forUpdate bool) (MarketplaceTrade, error) {
	q := `SELECT ` + tradeSelectCols + ` FROM marketplace_trades WHERE id = $1`
	if forUpdate {
		q += ` FOR UPDATE`
	}
	return scanTrade(tx.QueryRow(q, tradeID))
}

func (s *MarketplaceStore) writeTradeTx(tx *sql.Tx, trade MarketplaceTrade) error {
	_, err := tx.Exec(`
		UPDATE marketplace_trades SET
			reference = $2, handle = $3, buyer = $4, seller = $5,
			price_luna = $6, fee_luna = $7, escrow_address = $8, state = $9,
			version = $10, deposit_tx_hash = $11, deposit_block_height = $12,
			release_tx_hash = $13, claim_tx_hash = $14, payout_attempted_at = $15,
			payout_tx_hash = $16, refund_attempted_at = $17, refund_tx_hash = $18,
			deposit_deadline = $19, updated_at = $20
		WHERE id = $1`,
		trade.ID, trade.Reference, trade.Handle, trade.Buyer, trade.Seller,
		trade.PriceLuna, trade.FeeLuna, trade.EscrowAddress, string(trade.State),
		trade.Version, trade.DepositTxHash, trade.DepositBlockHeight,
		trade.ReleaseTxHash, trade.ClaimTxHash, trade.PayoutAttemptedAt,
		trade.PayoutTxHash, trade.RefundAttemptedAt, trade.RefundTxHash,
		trade.DepositDeadline, trade.UpdatedAt,
	)
	return err
}

// ConsumeNonce records a nonce as used, failing if it was already consumed.
func (s *MarketplaceStore) ConsumeNonce(nonce string) error {
	_, err := s.db.Exec(`INSERT INTO marketplace_nonces (nonce) VALUES ($1)`, nonce)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("nonce %q already used", nonce)
		}
		return err
	}
	return nil
}

func (s *MarketplaceStore) CreateListing(handle, seller string, priceLuna, feeLuna uint64, ownershipEpochTxHash string) (MarketplaceListing, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return MarketplaceListing{}, err
	}
	defer tx.Rollback()

	var status sql.NullString
	err = tx.QueryRow(`SELECT status FROM marketplace_listings WHERE handle = $1 FOR UPDATE`, handle).Scan(&status)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		createdAt := time.Now().Unix()
		listing := MarketplaceListing{
			Handle: handle, Seller: seller, PriceLuna: priceLuna, FeeLuna: feeLuna,
			Status: "active", OwnershipEpochTxHash: ownershipEpochTxHash, CreatedAt: createdAt,
		}
		_, err = tx.Exec(`
			INSERT INTO marketplace_listings (handle, seller, price_luna, fee_luna, status, ownership_epoch_tx_hash, created_at)
			VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
			handle, seller, priceLuna, feeLuna, ownershipEpochTxHash, createdAt,
		)
		if err != nil {
			if isUniqueViolation(err) {
				return MarketplaceListing{}, fmt.Errorf("an active listing for %q already exists", handle)
			}
			return MarketplaceListing{}, err
		}
		if err := tx.Commit(); err != nil {
			return MarketplaceListing{}, err
		}
		return listing, nil
	case err != nil:
		return MarketplaceListing{}, err
	case status.String == "active":
		return MarketplaceListing{}, fmt.Errorf("an active listing for %q already exists", handle)
	}

	createdAt := time.Now().Unix()
	listing := MarketplaceListing{
		Handle: handle, Seller: seller, PriceLuna: priceLuna, FeeLuna: feeLuna,
		Status: "active", OwnershipEpochTxHash: ownershipEpochTxHash, CreatedAt: createdAt,
	}
	_, err = tx.Exec(`
		UPDATE marketplace_listings SET seller = $2, price_luna = $3, fee_luna = $4,
			status = 'active', ownership_epoch_tx_hash = $5, created_at = $6
		WHERE handle = $1`,
		handle, seller, priceLuna, feeLuna, ownershipEpochTxHash, createdAt,
	)
	if err != nil {
		return MarketplaceListing{}, err
	}
	if err := tx.Commit(); err != nil {
		return MarketplaceListing{}, err
	}
	return listing, nil
}

func (s *MarketplaceStore) unpaidReservationCountTx(tx *sql.Tx, buyer string) (int, error) {
	compact := compactAddress(buyer)
	var n int
	err := tx.QueryRow(`
		SELECT COUNT(*) FROM marketplace_trades
		WHERE UPPER(REPLACE(buyer, ' ', '')) = $1
		  AND state IN ('RESERVED', 'AWAITING_DEPOSIT')
		  AND deposit_tx_hash = ''`,
		compact,
	).Scan(&n)
	return n, err
}

func (s *MarketplaceStore) ReserveListing(handle, tradeID, reference, buyer string) (MarketplaceTrade, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return MarketplaceTrade{}, err
	}
	defer tx.Rollback()

	listing, err := scanListing(tx.QueryRow(`
		SELECT handle, seller, price_luna, fee_luna, status, ownership_epoch_tx_hash, created_at
		FROM marketplace_listings WHERE handle = $1 FOR UPDATE`, handle,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return MarketplaceTrade{}, fmt.Errorf("no active listing for %q", handle)
	}
	if err != nil {
		return MarketplaceTrade{}, err
	}
	if listing.Status != "active" {
		return MarketplaceTrade{}, fmt.Errorf("no active listing for %q", handle)
	}

	var exists bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM marketplace_trades WHERE id = $1)`, tradeID).Scan(&exists); err != nil {
		return MarketplaceTrade{}, err
	}
	if exists {
		return MarketplaceTrade{}, fmt.Errorf("trade ID %q already in use", tradeID)
	}
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM marketplace_trades WHERE reference = $1)`, reference).Scan(&exists); err != nil {
		return MarketplaceTrade{}, err
	}
	if exists {
		return MarketplaceTrade{}, fmt.Errorf("reference %q already in use", reference)
	}

	unpaid, err := s.unpaidReservationCountTx(tx, buyer)
	if err != nil {
		return MarketplaceTrade{}, err
	}
	if unpaid >= maxUnpaidReservations {
		return MarketplaceTrade{}, fmt.Errorf("buyer has too many unpaid reservations")
	}

	now := time.Now().Unix()
	trade := MarketplaceTrade{
		ID: tradeID, Reference: reference, Handle: handle, Buyer: buyer, Seller: listing.Seller,
		PriceLuna: listing.PriceLuna, FeeLuna: listing.FeeLuna, State: StateReserved, Version: 1,
		DepositDeadline: now + depositDeadlineDuration,
		CreatedAt:       now, UpdatedAt: now,
	}

	_, err = tx.Exec(`UPDATE marketplace_listings SET status = 'reserved' WHERE handle = $1`, handle)
	if err != nil {
		return MarketplaceTrade{}, err
	}
	_, err = tx.Exec(`
		INSERT INTO marketplace_trades (
			id, reference, handle, buyer, seller, price_luna, fee_luna, state, version,
			deposit_deadline, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $10)`,
		trade.ID, trade.Reference, trade.Handle, trade.Buyer, trade.Seller,
		trade.PriceLuna, trade.FeeLuna, string(trade.State),
		trade.DepositDeadline, now,
	)
	if err != nil {
		return MarketplaceTrade{}, err
	}
	if err := tx.Commit(); err != nil {
		return MarketplaceTrade{}, err
	}
	return trade, nil
}

func (s *MarketplaceStore) releaseUnpaidReservationTx(tx *sql.Tx, tradeID string, to TradeState) error {
	trade, err := s.getTradeTx(tx, tradeID, true)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("no trade %q", tradeID)
		}
		return err
	}
	if !trade.isUnpaidReservation() {
		return fmt.Errorf("trade %q is not an unpaid reservation", tradeID)
	}
	if !trade.State.canTransitionTo(to) {
		return fmt.Errorf("transition %s -> %s is not allowed", trade.State, to)
	}

	var listingStatus sql.NullString
	err = tx.QueryRow(`SELECT status FROM marketplace_listings WHERE handle = $1 FOR UPDATE`, trade.Handle).Scan(&listingStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("no listing for handle %q", trade.Handle)
	}
	if err != nil {
		return err
	}

	now := time.Now().Unix()
	trade.State = to
	trade.Version++
	trade.UpdatedAt = now
	if err := s.writeTradeTx(tx, trade); err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE marketplace_listings SET status = 'active' WHERE handle = $1`, trade.Handle)
	return err
}

func (s *MarketplaceStore) CancelUnpaidReservation(tradeID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := s.releaseUnpaidReservationTx(tx, tradeID, StateCanceled); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *MarketplaceStore) ExpireStaleReservations(now int64) (int, error) {
	rows, err := s.db.Query(`
		SELECT id FROM marketplace_trades
		WHERE state IN ('RESERVED', 'AWAITING_DEPOSIT')
		  AND deposit_tx_hash = ''
		  AND deposit_deadline > 0
		  AND deposit_deadline <= $1`, now)
	if err != nil {
		return 0, err
	}
	var stale []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		stale = append(stale, id)
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	expired := 0
	for _, id := range stale {
		tx, err := s.db.Begin()
		if err != nil {
			log.Printf("marketplace: expire stale reservation %q: begin tx: %v", id, err)
			continue
		}
		if err := s.releaseUnpaidReservationTx(tx, id, StateExpired); err != nil {
			tx.Rollback()
			log.Printf("marketplace: expire stale reservation %q: %v", id, err)
			continue
		}
		if err := tx.Commit(); err != nil {
			log.Printf("marketplace: expire stale reservation %q: commit: %v", id, err)
			continue
		}
		expired++
	}
	return expired, nil
}

func (s *MarketplaceStore) Transition(tradeID string, from, to TradeState, mutate func(*MarketplaceTrade)) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	trade, err := s.getTradeTx(tx, tradeID, true)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("no trade %q", tradeID)
		}
		return err
	}
	if trade.State != from {
		return fmt.Errorf("trade %q is in state %s, expected %s", tradeID, trade.State, from)
	}
	if !from.canTransitionTo(to) {
		return fmt.Errorf("transition %s -> %s is not allowed", from, to)
	}
	if mutate != nil {
		mutate(&trade)
	}
	trade.State = to
	trade.Version++
	trade.UpdatedAt = time.Now().Unix()
	if err := s.writeTradeTx(tx, trade); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *MarketplaceStore) Resolve(tradeID string) (MarketplaceTrade, bool) {
	trade, err := scanTrade(s.db.QueryRow(`SELECT `+tradeSelectCols+` FROM marketplace_trades WHERE id = $1`, tradeID))
	if errors.Is(err, sql.ErrNoRows) {
		return MarketplaceTrade{}, false
	}
	if err != nil {
		return MarketplaceTrade{}, false
	}
	return trade, true
}

func (s *MarketplaceStore) FindTradeByReference(reference string) (MarketplaceTrade, bool) {
	trade, err := scanTrade(s.db.QueryRow(`SELECT `+tradeSelectCols+` FROM marketplace_trades WHERE reference = $1`, reference))
	if errors.Is(err, sql.ErrNoRows) {
		return MarketplaceTrade{}, false
	}
	if err != nil {
		return MarketplaceTrade{}, false
	}
	return trade, true
}

func (s *MarketplaceStore) ActiveListings() []MarketplaceListing {
	rows, err := s.db.Query(`
		SELECT handle, seller, price_luna, fee_luna, status, ownership_epoch_tx_hash, created_at
		FROM marketplace_listings WHERE status = 'active'`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	active := make([]MarketplaceListing, 0)
	for rows.Next() {
		listing, err := scanListing(rows)
		if err != nil {
			return active
		}
		active = append(active, listing)
	}
	return active
}

func (s *MarketplaceStore) TradesInState(state TradeState) []MarketplaceTrade {
	rows, err := s.db.Query(`SELECT `+tradeSelectCols+` FROM marketplace_trades WHERE state = $1`, string(state))
	if err != nil {
		return nil
	}
	defer rows.Close()
	return scanTrades(rows)
}

func (s *MarketplaceStore) AllTrades() []MarketplaceTrade {
	rows, err := s.db.Query(`SELECT ` + tradeSelectCols + ` FROM marketplace_trades`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	return scanTrades(rows)
}

func (s *MarketplaceStore) TradesForWallet(address string) []MarketplaceTrade {
	compact := compactAddress(address)
	rows, err := s.db.Query(`
		SELECT `+tradeSelectCols+` FROM marketplace_trades
		WHERE UPPER(REPLACE(buyer, ' ', '')) = $1 OR UPPER(REPLACE(seller, ' ', '')) = $1`,
		compact,
	)
	if err != nil {
		return nil
	}
	defer rows.Close()
	return scanTrades(rows)
}

func scanTrades(rows *sql.Rows) []MarketplaceTrade {
	trades := make([]MarketplaceTrade, 0)
	for rows.Next() {
		trade, err := scanTrade(rows)
		if err != nil {
			return trades
		}
		trades = append(trades, trade)
	}
	return trades
}

func (s *MarketplaceStore) MarkPayoutAttempt(tradeID string, attemptedAt int64) (MarketplaceTrade, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return MarketplaceTrade{}, err
	}
	defer tx.Rollback()

	trade, err := s.getTradeTx(tx, tradeID, true)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return MarketplaceTrade{}, fmt.Errorf("no trade %q", tradeID)
		}
		return MarketplaceTrade{}, err
	}
	if trade.State != StateSettlementPending {
		return MarketplaceTrade{}, fmt.Errorf("trade %q is in state %s, expected %s", tradeID, trade.State, StateSettlementPending)
	}
	if trade.PayoutAttemptedAt != 0 {
		return MarketplaceTrade{}, fmt.Errorf("trade %q already has a payout attempt", tradeID)
	}
	trade.PayoutAttemptedAt = attemptedAt
	trade.Version++
	trade.UpdatedAt = time.Now().Unix()
	if err := s.writeTradeTx(tx, trade); err != nil {
		return MarketplaceTrade{}, err
	}
	if err := tx.Commit(); err != nil {
		return MarketplaceTrade{}, err
	}
	return trade, nil
}

func (s *MarketplaceStore) MarkRefundAttempt(tradeID string, attemptedAt int64) (MarketplaceTrade, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return MarketplaceTrade{}, err
	}
	defer tx.Rollback()

	trade, err := s.getTradeTx(tx, tradeID, true)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return MarketplaceTrade{}, fmt.Errorf("no trade %q", tradeID)
		}
		return MarketplaceTrade{}, err
	}
	if trade.State != StateRefundPending {
		return MarketplaceTrade{}, fmt.Errorf("trade %q is in state %s, expected %s", tradeID, trade.State, StateRefundPending)
	}
	if trade.RefundAttemptedAt != 0 {
		return MarketplaceTrade{}, fmt.Errorf("trade %q already has a refund attempt", tradeID)
	}
	trade.RefundAttemptedAt = attemptedAt
	trade.Version++
	trade.UpdatedAt = time.Now().Unix()
	if err := s.writeTradeTx(tx, trade); err != nil {
		return MarketplaceTrade{}, err
	}
	if err := tx.Commit(); err != nil {
		return MarketplaceTrade{}, err
	}
	return trade, nil
}
