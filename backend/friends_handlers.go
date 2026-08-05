package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
)

type friendEntry struct {
	Address      string `json:"address"`
	Handle       string `json:"handle,omitempty"`
	DisplayName  string `json:"displayName,omitempty"`
	Status       string `json:"status"`
	FriendshipID string `json:"friendshipId"`
}

type friendRequestLimiter struct {
	mu     sync.Mutex
	now    func() time.Time
	window time.Duration
	limit  int
	hits   map[string][]time.Time
}

func newFriendRequestLimiter(limit int, window time.Duration) *friendRequestLimiter {
	return &friendRequestLimiter{
		now:    time.Now,
		window: window,
		limit:  limit,
		hits:   map[string][]time.Time{},
	}
}

func (l *friendRequestLimiter) allow(address string) bool {
	if l == nil || l.limit <= 0 {
		return true
	}
	key := compactAddress(address)
	now := l.now()
	cutoff := now.Add(-l.window)

	l.mu.Lock()
	defer l.mu.Unlock()

	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.limit {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	return true
}

func registerFriendsRoutes(
	mux *http.ServeMux,
	sessions *UserSessions,
	store *FriendStore,
	registry *HandleRegistry,
	profiles *ProfileStore,
	limiter *friendRequestLimiter,
) {
	mux.HandleFunc("GET /api/friends", friendsListHandler(sessions, store, registry, profiles))
	mux.HandleFunc("GET /api/friends/requests", friendsRequestsHandler(sessions, store, registry, profiles))
	mux.HandleFunc("POST /api/friends/requests", friendsSendRequestHandler(sessions, store, registry, profiles, limiter))
	mux.HandleFunc("POST /api/friends/requests/{id}/accept", friendsAcceptHandler(sessions, store))
	mux.HandleFunc("POST /api/friends/requests/{id}/decline", friendsDeclineHandler(sessions, store))
	mux.HandleFunc("DELETE /api/friends/{address}", friendsRemoveHandler(sessions, store))
}

func resolveFriendTarget(to string, registry *HandleRegistry) (string, error) {
	to = strings.TrimSpace(to)
	to = strings.TrimPrefix(to, "@")
	if to == "" {
		return "", errBadRequest
	}
	if isValidHandle(to) {
		if registry == nil {
			return "", errNotFound
		}
		claim, ok := registry.Resolve(to)
		if !ok {
			return "", errNotFound
		}
		return claim.Address, nil
	}
	if isValidNimiqAddress(to) {
		return to, nil
	}
	return "", errBadRequest
}

func enrichFriendEntry(actor string, f Friendship, registry *HandleRegistry, profiles *ProfileStore) friendEntry {
	actor = compactAddress(actor)
	other := compactAddress(f.RecipientAddress)
	status := "accepted"
	if f.Status == FriendshipPending {
		if compactAddress(f.RequesterAddress) == actor {
			other = compactAddress(f.RecipientAddress)
			status = "pending_out"
		} else {
			other = compactAddress(f.RequesterAddress)
			status = "pending_in"
		}
	} else if compactAddress(f.RequesterAddress) == actor {
		other = compactAddress(f.RecipientAddress)
	} else {
		other = compactAddress(f.RequesterAddress)
	}

	entry := friendEntry{
		Address:      other,
		Status:       status,
		FriendshipID: f.ID,
	}
	if registry != nil {
		if claim, ok := registry.ResolveAddress(other); ok {
			entry.Handle = claim.Handle
		}
	}
	if profiles != nil {
		if stored, err := profiles.Get(other); err == nil {
			var payload struct {
				DisplayName string `json:"display_name"`
			}
			if json.Unmarshal([]byte(stored.Profile), &payload) == nil && payload.DisplayName != "" {
				entry.DisplayName = payload.DisplayName
			}
		}
	}
	return entry
}

func friendsListHandler(sessions *UserSessions, store *FriendStore, registry *HandleRegistry, profiles *ProfileStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := requireUserSessionScope(sessions, r, ScopeFriendsRead)
		if !ok {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		list, err := store.ListFriends(actor)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "friends unavailable")
			return
		}
		out := make([]friendEntry, 0, len(list))
		for _, f := range list {
			out = append(out, enrichFriendEntry(actor, f, registry, profiles))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(out)
	}
}

func friendsRequestsHandler(sessions *UserSessions, store *FriendStore, registry *HandleRegistry, profiles *ProfileStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := requireUserSessionScope(sessions, r, ScopeFriendsRead)
		if !ok {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		list, err := store.ListRequests(actor)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "friends unavailable")
			return
		}
		out := make([]friendEntry, 0, len(list))
		for _, f := range list {
			out = append(out, enrichFriendEntry(actor, f, registry, profiles))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(out)
	}
}

func friendsSendRequestHandler(
	sessions *UserSessions,
	store *FriendStore,
	registry *HandleRegistry,
	profiles *ProfileStore,
	limiter *friendRequestLimiter,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := requireUserSessionScope(sessions, r, ScopeFriendsWrite)
		if !ok {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var req struct {
			To string `json:"to"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		to, err := resolveFriendTarget(req.To, registry)
		if errors.Is(err, errNotFound) {
			writeJSONError(w, http.StatusNotFound, "unknown handle")
			return
		}
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid handle or address")
			return
		}
		if !limiter.allow(actor) {
			writeJSONError(w, http.StatusTooManyRequests, "rate limited")
			return
		}
		f, err := store.SendRequest(actor, to)
		if errors.Is(err, errBadRequest) {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if errors.Is(err, errConflict) {
			writeJSONError(w, http.StatusConflict, "already friends or pending")
			return
		}
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "friends unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(enrichFriendEntry(actor, f, registry, profiles))
	}
}

func friendsAcceptHandler(sessions *UserSessions, store *FriendStore) http.HandlerFunc {
	return friendsStatusHandler(sessions, store.Accept)
}

func friendsDeclineHandler(sessions *UserSessions, store *FriendStore) http.HandlerFunc {
	return friendsStatusHandler(sessions, store.Decline)
}

func friendsStatusHandler(
	sessions *UserSessions,
	action func(id, actor string) (Friendship, error),
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := requireUserSessionScope(sessions, r, ScopeFriendsWrite)
		if !ok {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		id := r.PathValue("id")
		if id == "" {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		_, err := action(id, actor)
		if errors.Is(err, errUnauthorized) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if errors.Is(err, errNotFound) {
			writeJSONError(w, http.StatusNotFound, "not found")
			return
		}
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "friends unavailable")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func friendsRemoveHandler(sessions *UserSessions, store *FriendStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := requireUserSessionScope(sessions, r, ScopeFriendsWrite)
		if !ok {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		other := r.PathValue("address")
		if !isValidNimiqAddress(other) {
			writeJSONError(w, http.StatusBadRequest, "invalid address")
			return
		}
		err := store.Remove(actor, other)
		if errors.Is(err, errNotFound) {
			writeJSONError(w, http.StatusNotFound, "not found")
			return
		}
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "friends unavailable")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
