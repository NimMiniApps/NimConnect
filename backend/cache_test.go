package main

import (
	"errors"
	"testing"
	"time"
)

func TestRatesCache_FetchesOnFirstCall(t *testing.T) {
	calls := 0
	cache := NewRatesCache(60*time.Second, func() (RatesResponse, error) {
		calls++
		return RatesResponse{Source: "CoinGecko"}, nil
	})

	resp, err := cache.Get()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Stale {
		t.Errorf("expected stale=false on first fetch")
	}
	if calls != 1 {
		t.Errorf("expected 1 fetch call, got %d", calls)
	}
}

func TestRatesCache_ReturnsCachedWithinTTL(t *testing.T) {
	calls := 0
	cache := NewRatesCache(60*time.Second, func() (RatesResponse, error) {
		calls++
		return RatesResponse{Source: "CoinGecko"}, nil
	})
	fixedNow := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	cache.now = func() time.Time { return fixedNow }

	cache.Get()
	resp, err := cache.Get()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Stale {
		t.Errorf("expected stale=false within TTL")
	}
	if calls != 1 {
		t.Errorf("expected 1 fetch call (cached on second Get), got %d", calls)
	}
}

func TestRatesCache_RefetchesAfterTTL(t *testing.T) {
	calls := 0
	cache := NewRatesCache(60*time.Second, func() (RatesResponse, error) {
		calls++
		return RatesResponse{Source: "CoinGecko"}, nil
	})
	t0 := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	cache.now = func() time.Time { return t0 }
	cache.Get()

	cache.now = func() time.Time { return t0.Add(61 * time.Second) }
	cache.Get()

	if calls != 2 {
		t.Errorf("expected 2 fetch calls after TTL expiry, got %d", calls)
	}
}

func TestRatesCache_ReturnsStaleOnFetchErrorWithCache(t *testing.T) {
	calls := 0
	cache := NewRatesCache(60*time.Second, func() (RatesResponse, error) {
		calls++
		if calls == 1 {
			return RatesResponse{Source: "CoinGecko"}, nil
		}
		return RatesResponse{}, errors.New("coingecko down")
	})
	t0 := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	cache.now = func() time.Time { return t0 }
	if _, err := cache.Get(); err != nil {
		t.Fatalf("unexpected error on first Get: %v", err)
	}

	cache.now = func() time.Time { return t0.Add(61 * time.Second) }
	resp, err := cache.Get()
	if err != nil {
		t.Fatalf("expected no error when serving stale cache, got %v", err)
	}
	if !resp.Stale {
		t.Errorf("expected stale=true after fetch error with existing cache")
	}
	if resp.Source != "CoinGecko" {
		t.Errorf("expected cached source to be preserved, got %q", resp.Source)
	}
}

func TestRatesCache_ReturnsErrorWithNoCache(t *testing.T) {
	cache := NewRatesCache(60*time.Second, func() (RatesResponse, error) {
		return RatesResponse{}, errors.New("coingecko down")
	})

	_, err := cache.Get()
	if err == nil {
		t.Fatal("expected error when fetch fails with no existing cache")
	}
}
