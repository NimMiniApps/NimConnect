package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
)

const appRegistryMaxBodyBytes = 8 * 1024

// appGetHandler is public: a consent screen needs an app's verified
// identity before the wallet has authorized anything.
func appGetHandler(store *AuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rec, err := store.GetApp(r.PathValue("audience"))
		if errors.Is(err, errAppNotFound) {
			writeJSONError(w, http.StatusNotFound, "app not found")
			return
		}
		if err != nil {
			log.Printf("get app error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "app registry unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"audience":     rec.Audience,
			"display_name": rec.DisplayName,
			"icon_url":     rec.IconURL,
			"verified":     rec.Verified,
			"scopes":       rec.Scopes,
			"origins":      rec.Origins,
		})
	}
}

type adminAppMirrorRequest struct {
	Audience    string   `json:"audience"`
	DisplayName string   `json:"display_name"`
	IconURL     string   `json:"icon_url"`
	Verified    bool     `json:"verified"`
	OwnerID     string   `json:"owner_id"`
	Scopes      []string `json:"scopes"`
	Origins     []string `json:"origins"`
}

// adminAppsMirrorHandler upserts NimConnect's mirror of a catalog app
// record. There is no live catalog integration yet (see the design doc's
// open questions), so this is the manual/scripted path an admin or a future
// catalog webhook calls into.
func adminAppsMirrorHandler(sessions *AdminSessions, store *AuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessions.Valid(r.Header.Get("X-Admin-Session")) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, appRegistryMaxBodyBytes)
		var req adminAppMirrorRequest
		if json.NewDecoder(r.Body).Decode(&req) != nil || req.DisplayName == "" {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		rec := AppRecord{
			Audience: req.Audience, DisplayName: req.DisplayName, IconURL: req.IconURL,
			Verified: req.Verified, OwnerID: req.OwnerID, Scopes: req.Scopes, Origins: req.Origins,
		}
		if err := store.UpsertApp(rec); err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// adminAppAPIKeyIssueHandler (re)issues the app credential used to
// authenticate POST /api/awards. The plaintext key is shown once.
func adminAppAPIKeyIssueHandler(sessions *AdminSessions, store *AuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessions.Valid(r.Header.Get("X-Admin-Session")) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		key, err := store.IssueAppAPIKey(r.PathValue("audience"))
		if errors.Is(err, errAppNotFound) {
			writeJSONError(w, http.StatusNotFound, "app not found")
			return
		}
		if err != nil {
			log.Printf("issue app api key error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "app registry unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"api_key": key})
	}
}
