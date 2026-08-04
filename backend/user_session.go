package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

const userSessionTTL = 24 * time.Hour
const userSessionLoginWindow = 5 * time.Minute

type UserSessions struct {
	mu       sync.Mutex
	now      func() time.Time
	randRead func([]byte) (int, error)
	tokens   map[string]userSessionEntry
}

type userSessionEntry struct {
	address   string
	expiresAt time.Time
}

func NewUserSessions() *UserSessions {
	return &UserSessions{
		now:      time.Now,
		randRead: rand.Read,
		tokens:   map[string]userSessionEntry{},
	}
}

func userSessionChallenge(address string, expiresAtUnix int64) string {
	return fmt.Sprintf("nimconnect-session:v1:%s:%d", compactAddress(address), expiresAtUnix)
}

func (s *UserSessions) sweepLocked() {
	now := s.now()
	for token, e := range s.tokens {
		if !now.Before(e.expiresAt) {
			delete(s.tokens, token)
		}
	}
}

func (s *UserSessions) Issue(address string) (string, time.Time, error) {
	buf := make([]byte, 32)
	if _, err := s.randRead(buf); err != nil {
		return "", time.Time{}, err
	}
	token := hex.EncodeToString(buf)
	expiresAt := s.now().Add(userSessionTTL)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	s.tokens[token] = userSessionEntry{address: compactAddress(address), expiresAt: expiresAt}
	return token, expiresAt, nil
}

func (s *UserSessions) AddressFor(token string) (string, bool) {
	if token == "" {
		return "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	e, ok := s.tokens[token]
	if !ok {
		return "", false
	}
	return e.address, true
}

func (s *UserSessions) Revoke(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.tokens, token)
}
