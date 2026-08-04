package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"sync"
	"time"
)

const userSessionTTL = 24 * time.Hour
const userSessionLoginWindow = 5 * time.Minute
const defaultAudience = "nimconnect"

var audienceRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,31}$`)

type UserSessions struct {
	mu       sync.Mutex
	now      func() time.Time
	randRead func([]byte) (int, error)
	tokens   map[string]userSessionEntry
	used     map[string]time.Time // signature hash → first-use time
}

type userSessionEntry struct {
	address   string
	audience  string
	expiresAt time.Time
}

func NewUserSessions() *UserSessions {
	return &UserSessions{
		now:      time.Now,
		randRead: rand.Read,
		tokens:   map[string]userSessionEntry{},
		used:     map[string]time.Time{},
	}
}

func userSessionChallengeV1(address string, timestamp int64) string {
	return fmt.Sprintf("nimconnect-session:v1:%s:%d", compactAddress(address), timestamp)
}

func userSessionChallenge(address string, timestamp int64, audience string) string {
	return fmt.Sprintf("nimconnect-session:v2:%s:%d:%s", compactAddress(address), timestamp, audience)
}

func (s *UserSessions) sweepLocked() {
	now := s.now()
	for token, e := range s.tokens {
		if !now.Before(e.expiresAt) {
			delete(s.tokens, token)
		}
	}
	for key, usedAt := range s.used {
		if now.Sub(usedAt) > userSessionLoginWindow {
			delete(s.used, key)
		}
	}
}

// ConsumeSignature records a login signature as spent. Returns false if it was
// already used within the login window (replay).
func (s *UserSessions) ConsumeSignature(signature string) bool {
	sum := sha256.Sum256([]byte(signature))
	key := hex.EncodeToString(sum[:])

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	if _, ok := s.used[key]; ok {
		return false
	}
	s.used[key] = s.now()
	return true
}

func (s *UserSessions) Issue(address, audience string) (string, time.Time, error) {
	buf := make([]byte, 32)
	if _, err := s.randRead(buf); err != nil {
		return "", time.Time{}, err
	}
	token := hex.EncodeToString(buf)
	expiresAt := s.now().Add(userSessionTTL)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	s.tokens[token] = userSessionEntry{
		address:   compactAddress(address),
		audience:  audience,
		expiresAt: expiresAt,
	}
	return token, expiresAt, nil
}

func (s *UserSessions) SessionFor(token string) (address, audience string, ok bool) {
	if token == "" {
		return "", "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	e, ok := s.tokens[token]
	if !ok {
		return "", "", false
	}
	return e.address, e.audience, true
}

func (s *UserSessions) AddressFor(token string) (string, bool) {
	addr, _, ok := s.SessionFor(token)
	return addr, ok
}

func (s *UserSessions) Revoke(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.tokens, token)
}
