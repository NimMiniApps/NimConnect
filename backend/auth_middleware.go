package main

import (
	"context"
	"net/http"
)

type AuthActor struct {
	SessionID string
	Address   string
	Audience  string
	Scopes    map[string]struct{}
}

type authActorContextKey struct{}

func grantHasScope(grant AuthGrant, required string) bool {
	for _, scope := range grant.Scopes {
		if scope == required {
			return true
		}
	}
	return false
}

func resolveScopedActor(store *AuthStore, r *http.Request, required string) (AuthActor, bool) {
	if store == nil {
		return AuthActor{}, false
	}
	grant, err := store.ResolveSession(bearerToken(r))
	if err != nil || !grantHasScope(grant, required) {
		return AuthActor{}, false
	}
	scopes := make(map[string]struct{}, len(grant.Scopes))
	for _, scope := range grant.Scopes {
		scopes[scope] = struct{}{}
	}
	_ = store.TouchSession(bearerToken(r))
	return AuthActor{SessionID: grant.ID, Address: grant.Address, Audience: grant.Audience, Scopes: scopes}, true
}

func requireScope(store *AuthStore, scope string, next func(http.ResponseWriter, *http.Request, AuthActor)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := resolveScopedActor(store, r, scope)
		if !ok {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), authActorContextKey{}, actor))
		next(w, r, actor)
	}
}
