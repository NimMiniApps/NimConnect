package main

import (
	"sync"
	"time"
)

// RatesCache wraps a rate-fetching function with a TTL cache. If the fetch
// fails but a previous result exists, the cached result is returned with
// Stale set to true instead of propagating the error.
type RatesCache struct {
	mu        sync.Mutex
	rates     RatesResponse
	fetchedAt time.Time
	hasData   bool
	ttl       time.Duration
	fetch     func() (RatesResponse, error)
	now       func() time.Time
}

// NewRatesCache creates a cache that calls fetch to refresh data older than ttl.
func NewRatesCache(ttl time.Duration, fetch func() (RatesResponse, error)) *RatesCache {
	return &RatesCache{
		ttl:   ttl,
		fetch: fetch,
		now:   time.Now,
	}
}

// Get returns the current rates, refreshing them if the cache is empty or
// has expired. On refresh failure, it falls back to the last known good
// value with Stale=true if one exists.
func (c *RatesCache) Get() (RatesResponse, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.hasData && c.now().Sub(c.fetchedAt) < c.ttl {
		resp := c.rates
		resp.Stale = false
		return resp, nil
	}

	fresh, err := c.fetch()
	if err != nil {
		if c.hasData {
			resp := c.rates
			resp.Stale = true
			return resp, nil
		}
		return RatesResponse{}, err
	}

	c.rates = fresh
	c.fetchedAt = c.now()
	c.hasData = true

	resp := c.rates
	resp.Stale = false
	return resp, nil
}

// ChainHeightCache wraps an RPC block-height fetch with a short TTL cache so
// repeated requests (e.g. for a wallet's validityStartHeight, which only
// needs to be "recent enough") don't each hit the RPC node.
type ChainHeightCache struct {
	mu        sync.Mutex
	height    uint64
	fetchedAt time.Time
	hasData   bool
	ttl       time.Duration
	fetch     func() (uint64, error)
	now       func() time.Time
}

// NewChainHeightCache creates a cache that calls fetch to refresh the height
// once it is older than ttl.
func NewChainHeightCache(ttl time.Duration, fetch func() (uint64, error)) *ChainHeightCache {
	return &ChainHeightCache{
		ttl:   ttl,
		fetch: fetch,
		now:   time.Now,
	}
}

// Get returns the current chain height, refreshing it if the cache is empty
// or has expired. On refresh failure, it falls back to the last known good
// value if one exists.
func (c *ChainHeightCache) Get() (uint64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.hasData && c.now().Sub(c.fetchedAt) < c.ttl {
		return c.height, nil
	}

	fresh, err := c.fetch()
	if err != nil {
		if c.hasData {
			return c.height, nil
		}
		return 0, err
	}

	c.height = fresh
	c.fetchedAt = c.now()
	c.hasData = true
	return c.height, nil
}
