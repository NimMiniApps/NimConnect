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
	Audience  string `json:"audience"`
}

func requireUserSession(sessions *UserSessions, r *http.Request) (string, bool) {
	return sessions.AddressFor(r.Header.Get(userSessionHeader))
}

func requireUserSessionScope(sessions *UserSessions, r *http.Request, scope string) (string, bool) {
	if bearerToken(r) != "" {
		actor, ok := resolveScopedActor(sessions.scoped, r, scope)
		return actor.Address, ok
	}
	return requireUserSession(sessions, r)
}

func userSessionLoginHandler(sessions *UserSessions) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req userSessionLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}

		audience := req.Audience
		if audience == "" {
			audience = defaultAudience
		} else if !audienceRe.MatchString(audience) {
			writeJSONError(w, http.StatusBadRequest, "invalid audience")
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

		var challenge string
		if req.Audience == "" {
			// Compatibility: empty audience + v1 signature → audience=nimconnect.
			// Never fall back from an explicit v2 audience to v1.
			challenge = userSessionChallengeV1(req.Address, req.Timestamp)
		} else {
			challenge = userSessionChallenge(req.Address, req.Timestamp, audience)
		}
		if err := verifySignedMessage(req.Address, req.PublicKey, req.Signature, challenge); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if !sessions.ConsumeSignature(req.Signature) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		token, expiresAt, err := sessions.Issue(req.Address, audience)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "session unavailable")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"token":      token,
			"expires_at": expiresAt.Unix(),
			"audience":   audience,
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
