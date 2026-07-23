package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

const adminSessionTTL = 24 * time.Hour
const adminLoginWindow = 5 * time.Minute

// AdminSessions authenticates admins by Nimiq wallet signature (see
// adminLoginHandler) and issues short-lived opaque session tokens for
// whitelisted addresses. In-memory only — fine for a single-instance
// deployment; sessions reset on restart.
type AdminSessions struct {
	mu        sync.Mutex
	whitelist map[string]bool
	now       func() time.Time
	randRead  func([]byte) (int, error)
	tokens    map[string]time.Time
}

func parseAdminAddresses(raw string) []string {
	var out []string
	for _, a := range strings.Split(raw, ",") {
		a = strings.TrimSpace(a)
		if a != "" {
			out = append(out, a)
		}
	}
	return out
}

func NewAdminSessions(addresses []string) *AdminSessions {
	whitelist := make(map[string]bool, len(addresses))
	for _, a := range addresses {
		whitelist[compactAddress(a)] = true
	}
	return &AdminSessions{
		whitelist: whitelist,
		now:       time.Now,
		randRead:  rand.Read,
		tokens:    map[string]time.Time{},
	}
}

func (s *AdminSessions) IsAdmin(address string) bool {
	return s.whitelist[compactAddress(address)]
}

// sweep deletes expired tokens. Caller must hold s.mu.
func (s *AdminSessions) sweep() {
	now := s.now()
	for token, expiry := range s.tokens {
		if !now.Before(expiry) {
			delete(s.tokens, token)
		}
	}
}

func (s *AdminSessions) Issue() (string, time.Time, error) {
	buf := make([]byte, 32)
	if _, err := s.randRead(buf); err != nil {
		return "", time.Time{}, err
	}
	token := hex.EncodeToString(buf)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep()
	expiresAt := s.now().Add(adminSessionTTL)
	s.tokens[token] = expiresAt
	return token, expiresAt, nil
}

func (s *AdminSessions) Valid(token string) bool {
	if token == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep()
	_, ok := s.tokens[token]
	return ok
}

func adminLoginChallenge(address string, timestamp int64) string {
	return fmt.Sprintf("nimconnect-admin-login:v1:%s:%d", compactAddress(address), timestamp)
}

type adminLoginRequest struct {
	Address   string `json:"address"`
	PublicKey string `json:"publicKey"`
	Signature string `json:"signature"`
	Timestamp int64  `json:"timestamp"`
}

func adminLoginHandler(sessions *AdminSessions) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req adminLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}

		skew := sessions.now().Sub(time.Unix(req.Timestamp, 0))
		if skew < 0 {
			skew = -skew
		}
		if skew > adminLoginWindow {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		if !sessions.IsAdmin(req.Address) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		challenge := adminLoginChallenge(req.Address, req.Timestamp)
		if err := verifySignedMessage(req.Address, req.PublicKey, req.Signature, challenge); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		token, expiresAt, err := sessions.Issue()
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "session unavailable")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"token":      token,
			"expires_at": expiresAt.Unix(),
		})
	}
}
