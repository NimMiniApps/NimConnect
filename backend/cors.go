package main

import (
	"net/http"
	"slices"
	"strings"
)

// withCORS sets Access-Control-Allow-Origin and short-circuits OPTIONS
// preflight requests with 204.
//
// allowedOrigins is either "*", a single origin, or a comma-separated list of
// origins. For a single value (including "*"), that value is always sent. For
// a list, the request's Origin header is reflected back only if it's in the
// list, per the standard multi-origin CORS pattern (Access-Control-Allow-Origin
// cannot itself contain multiple values).
func withCORS(allowedOrigins string, next http.Handler) http.Handler {
	origins := strings.Split(allowedOrigins, ",")
	for i := range origins {
		origins[i] = strings.TrimSpace(origins[i])
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(origins) == 1 {
			w.Header().Set("Access-Control-Allow-Origin", origins[0])
		} else if reqOrigin := r.Header.Get("Origin"); slices.Contains(origins, reqOrigin) {
			w.Header().Set("Access-Control-Allow-Origin", reqOrigin)
			w.Header().Set("Vary", "Origin")
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Inbox-Public-Key, X-Inbox-Signature, X-Inbox-Issued-At")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
