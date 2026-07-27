package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"
)

// MarketplaceStore is a mutex-guarded in-memory listings/trades table
// persisted to one JSON file.
type MarketplaceStore struct {
	path string
	mu   sync.Mutex

	listings map[string]MarketplaceListing
	trades   map[string]MarketplaceTrade
	byRef    map[string]string
}

type marketplaceSnapshot struct {
	Listings map[string]MarketplaceListing `json:"listings"`
	Trades   map[string]MarketplaceTrade   `json:"trades"`
}

func NewMarketplaceStore(path string) *MarketplaceStore {
	s := &MarketplaceStore{
		path:     path,
		listings: map[string]MarketplaceListing{},
		trades:   map[string]MarketplaceTrade{},
		byRef:    map[string]string{},
	}
	if data, err := readFileIfExists(path); err == nil && data != nil {
		var snapshot marketplaceSnapshot
		if json.Unmarshal(data, &snapshot) == nil {
			if snapshot.Listings != nil {
				s.listings = snapshot.Listings
			}
			if snapshot.Trades != nil {
				s.trades = snapshot.Trades
				for id, trade := range snapshot.Trades {
					s.byRef[trade.Reference] = id
				}
			}
		}
	}
	return s
}

func (s *MarketplaceStore) persistLocked() error {
	data, err := json.Marshal(marketplaceSnapshot{Listings: s.listings, Trades: s.trades})
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *MarketplaceStore) CreateListing(handle, seller string, priceLuna, feeLuna uint64, ownershipEpochTxHash string) (MarketplaceListing, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, ok := s.listings[handle]; ok && existing.Status == "active" {
		return MarketplaceListing{}, fmt.Errorf("an active listing for %q already exists", handle)
	}
	previous, hadPrevious := s.listings[handle]
	listing := MarketplaceListing{
		Handle: handle, Seller: seller, PriceLuna: priceLuna, FeeLuna: feeLuna,
		Status: "active", OwnershipEpochTxHash: ownershipEpochTxHash, CreatedAt: time.Now().Unix(),
	}
	s.listings[handle] = listing
	if err := s.persistLocked(); err != nil {
		if hadPrevious {
			s.listings[handle] = previous
		} else {
			delete(s.listings, handle)
		}
		return MarketplaceListing{}, err
	}
	return listing, nil
}

func (s *MarketplaceStore) ReserveListing(handle, tradeID, reference, buyer string) (MarketplaceTrade, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	listing, ok := s.listings[handle]
	if !ok || listing.Status != "active" {
		return MarketplaceTrade{}, fmt.Errorf("no active listing for %q", handle)
	}
	if _, taken := s.trades[tradeID]; taken {
		return MarketplaceTrade{}, fmt.Errorf("trade ID %q already in use", tradeID)
	}
	if _, taken := s.byRef[reference]; taken {
		return MarketplaceTrade{}, fmt.Errorf("reference %q already in use", reference)
	}

	now := time.Now().Unix()
	trade := MarketplaceTrade{
		ID: tradeID, Reference: reference, Handle: handle, Buyer: buyer, Seller: listing.Seller,
		PriceLuna: listing.PriceLuna, FeeLuna: listing.FeeLuna, State: StateReserved, Version: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	listing.Status = "reserved"
	previousListing := s.listings[handle]
	s.listings[handle] = listing
	s.trades[tradeID] = trade
	s.byRef[reference] = tradeID
	if err := s.persistLocked(); err != nil {
		s.listings[handle] = previousListing
		delete(s.trades, tradeID)
		delete(s.byRef, reference)
		return MarketplaceTrade{}, err
	}
	return trade, nil
}

func (s *MarketplaceStore) Transition(tradeID string, from, to TradeState, mutate func(*MarketplaceTrade)) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	trade, ok := s.trades[tradeID]
	if !ok {
		return fmt.Errorf("no trade %q", tradeID)
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
	previous := s.trades[tradeID]
	s.trades[tradeID] = trade
	if err := s.persistLocked(); err != nil {
		s.trades[tradeID] = previous
		return err
	}
	return nil
}

func (s *MarketplaceStore) Resolve(tradeID string) (MarketplaceTrade, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	trade, ok := s.trades[tradeID]
	return trade, ok
}

func (s *MarketplaceStore) FindTradeByReference(reference string) (MarketplaceTrade, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tradeID, ok := s.byRef[reference]
	if !ok {
		return MarketplaceTrade{}, false
	}
	trade, ok := s.trades[tradeID]
	return trade, ok
}

// TradesInState returns copies of trades in state for workers that process a
// persisted lifecycle stage independently from incoming transactions.
func (s *MarketplaceStore) TradesInState(state TradeState) []MarketplaceTrade {
	s.mu.Lock()
	defer s.mu.Unlock()

	trades := make([]MarketplaceTrade, 0)
	for _, trade := range s.trades {
		if trade.State == state {
			trades = append(trades, trade)
		}
	}
	return trades
}

// MarkPayoutAttempt atomically records an outbound payout attempt before a
// signer can be called. An existing marker represents an ambiguous send and
// must never be automatically retried.
func (s *MarketplaceStore) MarkPayoutAttempt(tradeID string, attemptedAt int64) (MarketplaceTrade, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	trade, ok := s.trades[tradeID]
	if !ok {
		return MarketplaceTrade{}, fmt.Errorf("no trade %q", tradeID)
	}
	if trade.State != StateSettlementPending {
		return MarketplaceTrade{}, fmt.Errorf("trade %q is in state %s, expected %s", tradeID, trade.State, StateSettlementPending)
	}
	if trade.PayoutAttemptedAt != 0 {
		return MarketplaceTrade{}, fmt.Errorf("trade %q already has a payout attempt", tradeID)
	}
	previous := trade
	trade.PayoutAttemptedAt = attemptedAt
	trade.Version++
	trade.UpdatedAt = time.Now().Unix()
	s.trades[tradeID] = trade
	if err := s.persistLocked(); err != nil {
		s.trades[tradeID] = previous
		return MarketplaceTrade{}, err
	}
	return trade, nil
}

// MarkRefundAttempt atomically records an outbound refund attempt before a
// signer can be called. A retry is unsafe until an operator reconciles it.
func (s *MarketplaceStore) MarkRefundAttempt(tradeID string, attemptedAt int64) (MarketplaceTrade, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	trade, ok := s.trades[tradeID]
	if !ok {
		return MarketplaceTrade{}, fmt.Errorf("no trade %q", tradeID)
	}
	if trade.State != StateRefundPending {
		return MarketplaceTrade{}, fmt.Errorf("trade %q is in state %s, expected %s", tradeID, trade.State, StateRefundPending)
	}
	if trade.RefundAttemptedAt != 0 {
		return MarketplaceTrade{}, fmt.Errorf("trade %q already has a refund attempt", tradeID)
	}
	previous := trade
	trade.RefundAttemptedAt = attemptedAt
	trade.Version++
	trade.UpdatedAt = time.Now().Unix()
	s.trades[tradeID] = trade
	if err := s.persistLocked(); err != nil {
		s.trades[tradeID] = previous
		return MarketplaceTrade{}, err
	}
	return trade, nil
}
