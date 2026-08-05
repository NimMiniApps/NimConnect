package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
)

func backupGetHandler(store *BackupStore, authStores ...*AuthStore) http.HandlerFunc {
	var auth *AuthStore
	if len(authStores) > 0 {
		auth = authStores[0]
	}
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		if auth != nil {
			actor, ok := resolveScopedActor(auth, r, ScopeBackupRead)
			if !ok || compactAddress(actor.Address) != compactAddress(address) {
				writeJSONError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
		}
		rec, err := store.Get(address)
		w.Header().Set("Content-Type", "application/json")
		if errors.Is(err, errNotFound) {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "backup not found"})
			return
		}
		if err != nil {
			log.Printf("backup get error address=%q err=%q", address, err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "backup unavailable"})
			return
		}
		json.NewEncoder(w).Encode(rec)
	}
}

func backupHeadHandler(store *BackupStore, authStores ...*AuthStore) http.HandlerFunc {
	var auth *AuthStore
	if len(authStores) > 0 {
		auth = authStores[0]
	}
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		if auth != nil {
			actor, ok := resolveScopedActor(auth, r, ScopeBackupRead)
			if !ok || compactAddress(actor.Address) != compactAddress(address) {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
		}
		_, err := store.Get(address)
		if errors.Is(err, errNotFound) {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

const backupPutMaxBodyBytes = 256 * 1024

func backupPutHandler(store *BackupStore, authStores ...*AuthStore) http.HandlerFunc {
	var auth *AuthStore
	if len(authStores) > 0 {
		auth = authStores[0]
	}
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		r.Body = http.MaxBytesReader(w, r.Body, backupPutMaxBodyBytes)
		var req BackupPutRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid request"})
			return
		}

		var err error
		if bearerToken(r) != "" {
			actor, ok := resolveScopedActor(auth, r, ScopeBackupWrite)
			if !ok || compactAddress(actor.Address) != compactAddress(address) {
				writeJSONError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			err = store.PutAuthorized(actor.Address, req, AuthGrant{ID: actor.SessionID, Address: actor.Address, Audience: actor.Audience})
		} else {
			err = store.Put(address, req)
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case errors.Is(err, errBadRequest):
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid request"})
		case errors.Is(err, errUnauthorized):
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
		case errors.Is(err, errConflict):
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "newer backup exists"})
		case err != nil:
			log.Printf("backup put error address=%q err=%q", address, err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "backup unavailable"})
		default:
			json.NewEncoder(w).Encode(map[string]any{"ok": true, "exported_at": req.ExportedAt})
		}
	}
}
