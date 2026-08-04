package main

import (
	"database/sql"
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
			"ready":   "/api/ready",
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

func readyHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := db.PingContext(r.Context()); err != nil {
			log.Printf("ready check failed error=%q", err)
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{
				"status": "unavailable",
				"error":  "database unavailable",
			})
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
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

func chainHeightHandler(cache *ChainHeightCache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		height, err := cache.Get()
		if err != nil {
			log.Printf("chain height unavailable error=%q", err)
			writeJSONError(w, http.StatusBadGateway, "chain height unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]uint64{"height": height})
	}
}
