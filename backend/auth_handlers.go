package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

const authMaxBodyBytes = 16 * 1024

type createChallengeRequest struct {
	Address  string   `json:"address"`
	Audience string   `json:"audience"`
	Scopes   []string `json:"scopes"`
}

type exchangeChallengeRequest struct {
	ChallengeID string `json:"challenge_id"`
	PublicKey   string `json:"public_key"`
	Signature   string `json:"signature"`
}

func createAuthChallengeHandler(store *AuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, authMaxBodyBytes)
		var req createChallengeRequest
		if json.NewDecoder(r.Body).Decode(&req) != nil || !isValidNimiqAddress(req.Address) || !authorizationAudienceRe.MatchString(req.Audience) {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		canonical, err := validateAuthorizationScopes(req.Scopes)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid scopes")
			return
		}
		allowed, err := store.OriginAllowed(req.Audience, r.Header.Get("Origin"))
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "authorization unavailable")
			return
		}
		if !allowed {
			writeJSONError(w, http.StatusForbidden, "app origin not allowed")
			return
		}
		challenge, err := store.CreateChallenge(req.Address, req.Audience, canonical, func(nonce string, expiresAt time.Time) string {
			message, _, _ := buildAuthorizationMessage(req.Address, req.Audience, canonical, expiresAt, nonce)
			return message
		})
		if errors.Is(err, errAuthScopeNotAllowed) {
			writeJSONError(w, http.StatusForbidden, "scopes not allowed")
			return
		}
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "authorization unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"challenge_id": challenge.ID, "message": challenge.Message, "address": normalizeAddress(challenge.Address),
			"audience": challenge.Audience, "scopes": challenge.Scopes, "expires_at": challenge.ExpiresAt.Unix(),
		})
	}
}

func createAuthSessionHandler(store *AuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, authMaxBodyBytes)
		var req exchangeChallengeRequest
		if json.NewDecoder(r.Body).Decode(&req) != nil || req.ChallengeID == "" {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		challenge, err := store.GetChallenge(req.ChallengeID)
		if err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if verifySignedMessage(challenge.Address, req.PublicKey, req.Signature, challenge.Message) != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		consumed, err := store.ConsumeChallenge(req.ChallengeID)
		if err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		token, grant, err := store.IssueSession(consumed.Address, consumed.Audience, consumed.Scopes)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "authorization unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"token": token, "address": normalizeAddress(grant.Address), "audience": grant.Audience,
			"scopes": grant.Scopes, "expires_at": grant.ExpiresAt.Unix(),
		})
	}
}

func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if len(header) < 8 || !strings.EqualFold(header[:7], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(header[7:])
}

func authSessionInfoHandler(store *AuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		grant, err := store.ResolveSession(bearerToken(r))
		if err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"address": normalizeAddress(grant.Address), "audience": grant.Audience, "scopes": grant.Scopes, "expires_at": grant.ExpiresAt.Unix()})
	}
}

func authSessionRevokeHandler(store *AuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if _, err := store.ResolveSession(token); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if store.RevokeSession(token) != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func authSessionsRevokeAllHandler(store *AuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		grant, err := store.ResolveSession(bearerToken(r))
		if err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if _, err := store.RevokeAllSessions(grant.Address); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "authorization unavailable")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
