package main

import (
	"encoding/json"
	"log"
	"net/http"
)

func rootHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"service": "nimconnect-backend",
		"status":  "ok",
		"version": currentVersion(),
		"endpoints": map[string]string{
			"health":  "/api/health",
			"rates":   "/api/rates",
			"backup":  "/api/backup/{address}",
			"version": "/api/version",
		},
	})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	version := currentVersion()
	json.NewEncoder(w).Encode(map[string]any{
		"status":         "ok",
		"commit_hash":    version.CommitHash,
		"build_time":     version.BuildTime,
		"uptime_seconds": version.UptimeSeconds,
	})
}

func versionHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(currentVersion())
}

func ratesHandler(cache *RatesCache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp, err := cache.Get()
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			log.Printf("rates unavailable error=%q", err)
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": "rates unavailable"})
			return
		}
		log.Printf("rates served stale=%t fetched_at=%s source=%s", resp.Stale, resp.FetchedAt, resp.Source)
		json.NewEncoder(w).Encode(resp)
	}
}
