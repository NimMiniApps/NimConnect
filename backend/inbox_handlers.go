package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"
)

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func inboxPostHandler(store *InboxStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req InboxSendRequest
		r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		id, replay, err := store.Put(req)
		switch {
		case errors.Is(err, errBadRequest):
			writeJSONError(w, http.StatusBadRequest, "invalid request")
		case errors.Is(err, errUnauthorized):
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
		case errors.Is(err, errConflict):
			writeJSONError(w, http.StatusConflict, "sent_at outside accepted window")
		case errors.Is(err, errTooMany):
			writeJSONError(w, http.StatusTooManyRequests, "mailbox full")
		case err != nil:
			log.Printf("inbox post error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "inbox unavailable")
		default:
			w.Header().Set("Content-Type", "application/json")
			if replay {
				w.WriteHeader(http.StatusOK)
			} else {
				w.WriteHeader(http.StatusCreated)
			}
			json.NewEncoder(w).Encode(map[string]string{"id": id})
		}
	}
}

// inboxReadAuth verifies the replayable read capability headers for a mailbox.
func inboxReadAuth(r *http.Request, address string, now time.Time) error {
	issuedAt, err := strconv.ParseInt(r.Header.Get("X-Inbox-Issued-At"), 10, 64)
	if err != nil {
		return errUnauthorized
	}
	issued := time.UnixMilli(issuedAt)
	maxAgeMs := int64(inboxReadMaxAge / time.Millisecond)
	if now.UnixMilli()-issuedAt > maxAgeMs || issued.After(now.Add(inboxSendWindow)) {
		return errUnauthorized
	}
	if err := verifySignedMessage(
		address,
		r.Header.Get("X-Inbox-Public-Key"),
		r.Header.Get("X-Inbox-Signature"),
		inboxReadMessage(address, issuedAt),
	); err != nil {
		return errUnauthorized
	}
	return nil
}

func inboxListHandler(store *InboxStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		if !isValidNimiqAddress(address) {
			writeJSONError(w, http.StatusBadRequest, "invalid address")
			return
		}
		if err := inboxReadAuth(r, address, store.now()); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		msgs, err := store.List(address)
		if err != nil {
			log.Printf("inbox list error address=%q err=%q", compactAddress(address), err)
			writeJSONError(w, http.StatusInternalServerError, "inbox unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"messages": msgs})
	}
}

func inboxDeleteHandler(store *InboxStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		if !isValidNimiqAddress(address) {
			writeJSONError(w, http.StatusBadRequest, "invalid address")
			return
		}
		if err := inboxReadAuth(r, address, store.now()); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		err := store.Delete(address, r.PathValue("id"))
		switch {
		case errors.Is(err, errBadRequest):
			writeJSONError(w, http.StatusBadRequest, "invalid message id")
		case errors.Is(err, errNotFound):
			writeJSONError(w, http.StatusNotFound, "not found")
		case err != nil:
			log.Printf("inbox delete error address=%q err=%q", compactAddress(address), err)
			writeJSONError(w, http.StatusInternalServerError, "inbox unavailable")
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}
}
