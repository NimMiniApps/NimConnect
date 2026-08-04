package main

import (
	"encoding/json"
	"net/http"
	"time"
)

const userSessionHeader = "X-NimConnect-Session"

type userSessionLoginRequest struct {
	Address   string `json:"address"`
	PublicKey string `json:"publicKey"`
	Signature string `json:"signature"`
	Timestamp int64  `json:"timestamp"`
}

func requireUserSession(sessions *UserSessions, r *http.Request) (string, bool) {
	return sessions.AddressFor(r.Header.Get(userSessionHeader))
}

func userSessionLoginHandler(sessions *UserSessions) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req userSessionLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}

		skew := sessions.now().Sub(time.Unix(req.Timestamp, 0))
		if skew < 0 {
			skew = -skew
		}
		if skew > userSessionLoginWindow {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		challenge := userSessionChallenge(req.Address, req.Timestamp)
		if err := verifySignedMessage(req.Address, req.PublicKey, req.Signature, challenge); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		token, expiresAt, err := sessions.Issue(req.Address)
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

func userSessionLogoutHandler(sessions *UserSessions) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get(userSessionHeader)
		if token == "" {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if _, ok := sessions.AddressFor(token); !ok {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		sessions.Revoke(token)
		w.WriteHeader(http.StatusNoContent)
	}
}
