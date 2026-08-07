package main

import (
	"encoding/json"
	"log"
	"net/http"
)

// authorizationsListHandler answers "which apps did I authorize" for the
// caller's own wallet. First-party session only (X-NimConnect-Session): a
// third-party app's own scoped token is for that app alone and has no
// business enumerating a wallet's grants to every other app.
func authorizationsListHandler(sessions *UserSessions, store *AuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		address, ok := requireUserSession(sessions, r)
		if !ok {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		grants, err := store.ListGrants(address)
		if err != nil {
			log.Printf("list authorizations error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "authorizations unavailable")
			return
		}
		out := make([]map[string]any, 0, len(grants))
		for _, g := range grants {
			out = append(out, map[string]any{
				"audience":     g.Audience,
				"display_name": g.DisplayName,
				"icon_url":     g.IconURL,
				"verified":     g.Verified,
				"scopes":       g.Scopes,
				"granted_at":   g.CreatedAt.Unix(),
				"expires_at":   g.ExpiresAt.Unix(),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"authorizations": out})
	}
}
