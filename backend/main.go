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
	stats := NewStats(getEnv("STATS_FILE", "/data/stats.json"))
	adminToken := os.Getenv("ADMIN_TOKEN")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", rootHandler)
	mux.HandleFunc("GET /api/health", healthHandler)
	mux.HandleFunc("GET /api/version", versionHandler)
	mux.HandleFunc("GET /api/rates", func(w http.ResponseWriter, r *http.Request) {
		stats.RecordOpen()
		ratesHandler(ratesCache)(w, r)
	})
	mux.HandleFunc("GET /api/stats", statsHandler(stats, adminToken))
	mux.HandleFunc("GET /api/backup/{address}", withWalletStat(stats, backupGetHandler(backupStore)))
	mux.HandleFunc("HEAD /api/backup/{address}", withWalletStat(stats, backupHeadHandler(backupStore)))
	mux.HandleFunc("PUT /api/backup/{address}", withWalletStat(stats, backupPutHandler(backupStore)))
	mux.HandleFunc("POST /api/inbox/messages", inboxPostHandler(inboxStore))
	mux.HandleFunc("GET /api/inbox/{address}/messages", withWalletStat(stats, inboxListHandler(inboxStore)))
	mux.HandleFunc("DELETE /api/inbox/{address}/messages/{id}", withWalletStat(stats, inboxDeleteHandler(inboxStore)))

	// On-chain handle registry — disabled unless REGISTRY_ADDRESS is set.
	registryAddress := os.Getenv("REGISTRY_ADDRESS")
	if registryAddress != "" {
		rpc := NewNimiqRPC(httpClient, getEnv("NIMIQ_RPC_URL", "https://rpc-mainnet.nimiqscan.com"))
		reserved := loadReservedHandles(getEnv("RESERVED_HANDLES_FILE", "/data/reserved-handles.json"))
		registry := NewHandleRegistry(getEnv("HANDLES_FILE", "/data/handles.json"), reserved)
		profiles := NewProfileStore(getEnv("PROFILES_DIR", "/data/profiles"))
		syncer := NewHandleSyncer(rpc, registry, registryAddress)
		go syncer.Run(2*time.Minute, make(chan struct{}))

		mux.HandleFunc("GET /api/resolve/{handle}", resolveHandler(registry))
		mux.HandleFunc("GET /api/profile/{address}", profileGetHandler(profiles))
		mux.HandleFunc("PUT /api/profile/{address}", profilePutHandler(profiles))
		mux.HandleFunc("DELETE /api/profile/{address}", profileDeleteHandler(profiles))
		mux.HandleFunc("GET /api/handles/check", handleCheckHandler(registry))
		mux.HandleFunc("GET /api/handles/by-address/{address}", handleByAddressHandler(registry))
		mux.HandleFunc("POST /api/handles/claims", claimSubmitHandler(syncer, registry))

		publicOrigin := getEnv("PUBLIC_APP_ORIGIN", "https://nimconnect.nimiqminiapps.com")
		mux.HandleFunc("GET /p/{handle}", publicPageHandler(registry, profiles, publicOrigin))
	}

	log.Printf("NimConnect backend listening on :%s commit=%s build_time=%s", port, CommitHash, BuildTime)
	if err := http.ListenAndServe(":"+port, withRequestLogging(withCORS(allowedOrigin, mux))); err != nil {
		log.Fatal(err)
	}
}
