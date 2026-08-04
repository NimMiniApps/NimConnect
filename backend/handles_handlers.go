package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
)

func writeCached(w http.ResponseWriter, r *http.Request, etag string, payload any) {
	w.Header().Set("ETag", `"`+etag+`"`)
	w.Header().Set("Cache-Control", "public, max-age=60")
	if r.Header.Get("If-None-Match") == `"`+etag+`"` {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(payload)
}

func resolveHandler(registry *HandleRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handle := r.PathValue("handle")
		if !isValidHandle(handle) {
			writeJSONError(w, http.StatusBadRequest, "invalid handle")
			return
		}
		claim, ok := registry.Resolve(handle)
		if !ok {
			writeJSONError(w, http.StatusNotFound, "unknown handle")
			return
		}
		writeCached(w, r, claim.TxHash, claim)
	}
}

// paymentResolveHandler refreshes the registry before resolving a payment
// recipient. Unlike the cacheable identity resolver, it must not serve a
// known-stale owner when the chain cannot be checked.
func paymentResolveHandler(syncer *HandleSyncer, registry *HandleRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		handle := r.PathValue("handle")
		if !isValidHandle(handle) {
			writeJSONError(w, http.StatusBadRequest, "invalid handle")
			return
		}
		if err := syncer.Sweep(); err != nil {
			log.Printf("payment handle refresh failed handle=%q err=%q", handle, err)
			writeJSONError(w, http.StatusServiceUnavailable, "handle resolution unavailable")
			return
		}
		// Fail closed when history completeness is not proven (SEC-004).
		if !syncer.Complete() {
			writeJSONError(w, http.StatusServiceUnavailable, "handle resolution unavailable")
			return
		}
		claim, ok := registry.Resolve(handle)
		if !ok {
			writeJSONError(w, http.StatusNotFound, "unknown handle")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(claim)
	}
}

func profileGetHandler(store *ProfileStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stored, err := store.Get(r.PathValue("address"))
		switch {
		case errors.Is(err, errBadRequest):
			writeJSONError(w, http.StatusBadRequest, "invalid address")
		case errors.Is(err, errNotFound):
			writeJSONError(w, http.StatusNotFound, "no profile")
		case err != nil:
			log.Printf("profile get error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "profiles unavailable")
		default:
			writeCached(w, r, strconv.FormatInt(stored.UpdatedAt, 10), map[string]any{
				"address":    stored.Address,
				"updated_at": stored.UpdatedAt,
				"profile":    json.RawMessage(stored.Profile),
			})
		}
	}
}

func profilePutHandler(store *ProfileStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req ProfilePutRequest
		r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if compactAddress(req.Address) != compactAddress(r.PathValue("address")) {
			writeJSONError(w, http.StatusBadRequest, "address mismatch")
			return
		}
		err := store.Put(req)
		switch {
		case errors.Is(err, errBadRequest):
			writeJSONError(w, http.StatusBadRequest, "invalid profile")
		case errors.Is(err, errUnauthorized):
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
		case errors.Is(err, errConflict):
			writeJSONError(w, http.StatusConflict, "stale updated_at")
		case err != nil:
			log.Printf("profile put error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "profiles unavailable")
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}
}

func profileDeleteHandler(store *ProfileStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		updatedAt, err := strconv.ParseInt(r.Header.Get("X-Profile-Updated-At"), 10, 64)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid updated_at")
			return
		}
		err = store.Delete(
			r.PathValue("address"),
			updatedAt,
			r.Header.Get("X-Profile-Public-Key"),
			r.Header.Get("X-Profile-Signature"),
		)
		switch {
		case errors.Is(err, errBadRequest):
			writeJSONError(w, http.StatusBadRequest, "invalid request")
		case errors.Is(err, errUnauthorized):
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
		case errors.Is(err, errNotFound):
			writeJSONError(w, http.StatusNotFound, "no profile")
		case errors.Is(err, errConflict):
			writeJSONError(w, http.StatusConflict, "stale updated_at")
		case err != nil:
			log.Printf("profile delete error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "profiles unavailable")
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}
}

// handleCheckHandler is advisory only — the chain is authoritative.
func handleCheckHandler(registry *HandleRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handle := r.URL.Query().Get("h")
		available, reason := registry.Available(handle)
		resp := map[string]any{"handle": handle, "available": available}
		if reason != "" {
			resp["reason"] = reason
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

// claimSubmitHandler is the fast path after the app sends a claim tx: verify
// the tx targets the registry and parses, then sweep so it's indexed promptly.
//
// Accepts either an already-broadcast tx_hash (Nimiq Pay, which signs and
// sends in one step) or a Hub-signed raw_hex (Hub's signTransaction flow,
// which only signs — checkout() can't be used here since it requires
// value > 0 and a handle claim is a value-0 registry message).
func claimSubmitHandler(syncer *HandleSyncer, registry *HandleRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			TxHash string `json:"tx_hash,omitempty"`
			RawHex string `json:"raw_hex,omitempty"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}

		var tx *rpcTx
		switch {
		case req.RawHex != "":
			hash, err := syncer.rpc.SendRawTransaction(req.RawHex)
			if err != nil {
				writeJSONError(w, http.StatusBadGateway, "failed to broadcast transaction")
				return
			}
			tx, err = syncer.rpc.GetTransactionByHash(hash)
			if err != nil {
				writeJSONError(w, http.StatusBadGateway, "chain lookup failed")
				return
			}
		case len(req.TxHash) > 0 && len(req.TxHash) <= 128:
			var err error
			tx, err = syncer.rpc.GetTransactionByHash(req.TxHash)
			if err != nil {
				writeJSONError(w, http.StatusBadGateway, "chain lookup failed")
				return
			}
		default:
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}

		action := parseClaimData(tx.data())
		if action == nil || compactAddress(tx.recipient()) != compactAddress(syncer.registryAddress) {
			writeJSONError(w, http.StatusBadRequest, "not a registry claim")
			return
		}
		if err := syncer.Sweep(); err != nil {
			log.Printf("claim submit sweep failed err=%q", err)
		}
		claim, ok := registry.Resolve(action.Handle)
		status := "pending" // tx seen but not yet in the indexed set (or lost the race)
		var body any
		if ok {
			status = "indexed"
			body = claim
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"status": status, "claim": body})
	}
}

func adminHandlesResyncHandler(sessions *AdminSessions, registry *HandleRegistry, syncer *HandleSyncer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessions.Valid(r.Header.Get("X-Admin-Session")) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if registry == nil {
			writeJSONError(w, http.StatusServiceUnavailable, "handles disabled")
			return
		}
		if err := registry.PurgeHandles(); err != nil {
			log.Printf("handle resync purge failed err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "purge failed")
			return
		}
		if syncer != nil {
			if err := syncer.ForceSweep(); err != nil {
				log.Printf("handle resync sweep failed err=%q", err)
				writeJSONError(w, http.StatusInternalServerError, "sync failed")
				return
			}
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleByAddressHandler(registry *HandleRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claim, ok := registry.ResolveAddress(r.PathValue("address"))
		if !ok {
			writeJSONError(w, http.StatusNotFound, "no handle")
			return
		}
		writeCached(w, r, claim.TxHash, claim)
	}
}
