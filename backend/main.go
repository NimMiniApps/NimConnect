package main

import (
	"log"
	"net/http"
	"os"
	"time"
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	port := getEnv("PORT", "8787")
	coinGeckoBaseURL := getEnv("COINGECKO_API_BASE", "https://api.coingecko.com/api/v3")
	allowedOrigin := getEnv("ALLOWED_ORIGIN", "*")
	backupDir := getEnv("BACKUP_DIR", "/data/backups")

	httpClient := &http.Client{Timeout: 10 * time.Second}

	ratesCache := NewRatesCache(60*time.Second, func() (RatesResponse, error) {
		return FetchRates(httpClient, coinGeckoBaseURL)
	})

	backupStore := NewBackupStore(backupDir)
	inboxStore := NewInboxStore(getEnv("INBOX_DIR", "/data/inbox"))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", rootHandler)
	mux.HandleFunc("GET /api/health", healthHandler)
	mux.HandleFunc("GET /api/version", versionHandler)
	mux.HandleFunc("GET /api/rates", ratesHandler(ratesCache))
	mux.HandleFunc("GET /api/backup/{address}", backupGetHandler(backupStore))
	mux.HandleFunc("HEAD /api/backup/{address}", backupHeadHandler(backupStore))
	mux.HandleFunc("PUT /api/backup/{address}", backupPutHandler(backupStore))
	mux.HandleFunc("POST /api/inbox/messages", inboxPostHandler(inboxStore))
	mux.HandleFunc("GET /api/inbox/{address}/messages", inboxListHandler(inboxStore))
	mux.HandleFunc("DELETE /api/inbox/{address}/messages/{id}", inboxDeleteHandler(inboxStore))

	log.Printf("NimConnect backend listening on :%s commit=%s build_time=%s", port, CommitHash, BuildTime)
	if err := http.ListenAndServe(":"+port, withRequestLogging(withCORS(allowedOrigin, mux))); err != nil {
		log.Fatal(err)
	}
}
