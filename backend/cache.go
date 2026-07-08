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
