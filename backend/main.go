package main

import (
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"time"
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// parseActivationHeight parses RELEASE_ACTIVATION_HEIGHT. Empty or invalid
// input fails closed (math.MaxUint64: no release is ever honored), rather
// than defaulting to always active.
func parseActivationHeight(v string) uint64 {
	if v == "" {
		return math.MaxUint64
	}
	h, err := strconv.ParseUint(v, 10, 64)
	if err != nil {
		return math.MaxUint64
	}
	return h
}

func parseUintEnv(v string, fallback uint64) uint64 {
	parsed, err := strconv.ParseUint(v, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

// runSweepLoop calls sweep on a fixed interval until the process exits,
// logging failures without crashing the server.
func runSweepLoop(interval time.Duration, sweep func() error) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if err := sweep(); err != nil {
			log.Printf("marketplace sweep failed err=%q", err)
		}
		<-ticker.C
	}
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
	adminSessions := NewAdminSessions(parseAdminAddresses(getEnv("ADMIN_ADDRESSES", "")))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", rootHandler)
	mux.HandleFunc("GET /api/health", healthHandler)
	mux.HandleFunc("GET /api/version", versionHandler)
	mux.HandleFunc("GET /api/rates", func(w http.ResponseWriter, r *http.Request) {
		stats.RecordOpen()
		ratesHandler(ratesCache)(w, r)
	})
	mux.HandleFunc("POST /api/admin/login", adminLoginHandler(adminSessions))
	mux.HandleFunc("GET /api/stats", statsHandler(stats, adminSessions))
	mux.HandleFunc("GET /api/backup/{address}", withWalletStat(stats, backupGetHandler(backupStore)))
	mux.HandleFunc("HEAD /api/backup/{address}", withWalletStat(stats, backupHeadHandler(backupStore)))
	mux.HandleFunc("PUT /api/backup/{address}", withWalletStat(stats, backupPutHandler(backupStore)))
	mux.HandleFunc("POST /api/inbox/messages", inboxPostHandler(inboxStore))
	mux.HandleFunc("GET /api/inbox/{address}/messages", withWalletStat(stats, inboxListHandler(inboxStore)))
	mux.HandleFunc("DELETE /api/inbox/{address}/messages/{id}", withWalletStat(stats, inboxDeleteHandler(inboxStore)))

	// On-chain handle registry — defaults to the shared NimFeed catalog address.
	registryAddress := getEnv("REGISTRY_ADDRESS", NimfeedCatalogAddress)
	if registryAddress != "off" {
		rpc := NewNimiqRPC(httpClient, getEnv("NIMIQ_RPC_URL", "https://rpc-mainnet.nimiqscan.com"))
		reserved := loadReservedHandles(getEnv("RESERVED_HANDLES_FILE", "/data/reserved-handles.json"))
		releaseActivationHeight := parseActivationHeight(getEnv("RELEASE_ACTIVATION_HEIGHT", ""))
		registry := NewHandleRegistry(getEnv("HANDLES_FILE", "/data/handles.json"), reserved, releaseActivationHeight)
		profiles := NewProfileStore(getEnv("PROFILES_DIR", "/data/profiles"))
		syncer := NewHandleSyncer(rpc, registry, registryAddress)
		go syncer.Run(2*time.Minute, make(chan struct{}))

		chainHeightCache := NewChainHeightCache(2*time.Second, rpc.GetBlockNumber)
		mux.HandleFunc("GET /api/chain/height", chainHeightHandler(chainHeightCache))
		mux.HandleFunc("GET /api/resolve/{handle}", resolveHandler(registry))
		mux.HandleFunc("GET /api/pay/resolve/{handle}", paymentResolveHandler(syncer, registry))
		mux.HandleFunc("GET /api/profile/{address}", profileGetHandler(profiles))
		mux.HandleFunc("PUT /api/profile/{address}", profilePutHandler(profiles))
		mux.HandleFunc("DELETE /api/profile/{address}", profileDeleteHandler(profiles))
		mux.HandleFunc("GET /api/handles/check", handleCheckHandler(registry))
		mux.HandleFunc("GET /api/handles/by-address/{address}", handleByAddressHandler(registry))
		mux.HandleFunc("POST /api/handles/claims", claimSubmitHandler(syncer, registry))

		publicOrigin := getEnv("PUBLIC_APP_ORIGIN", "https://nimconnect.nimiqminiapps.com")
		mux.HandleFunc("GET /p/{handle}", publicPageHandler(registry, profiles, publicOrigin))

		escrowAddress := getEnv("ESCROW_ADDRESS", "")
		if escrowAddress != "" {
			marketplaceStore := NewMarketplaceStore(getEnv("MARKETPLACE_FILE", "/data/marketplace.json"))
			ledger, err := OpenEscrowLedger(getEnv("MARKETPLACE_LEDGER_FILE", "/data/marketplace_ledger.jsonl"))
			if err != nil {
				log.Fatalf("failed to open escrow ledger: %v", err)
			}
			escrowSignerRPC := NewNimiqRPC(httpClient, getEnv("ESCROW_SIGNER_RPC_URL", getEnv("NIMIQ_RPC_URL", "https://rpc-mainnet.nimiqscan.com")))
			settlement := NewSettlementWorker(marketplaceStore, ledger, escrowSignerRPC, escrowAddress)
			escrowWatcher := NewEscrowWatcher(rpc, marketplaceStore, escrowAddress)
			ownershipWatcher := NewOwnershipWatcher(rpc, marketplaceStore, registry, settlement)
			go runSweepLoop(2*time.Minute, escrowWatcher.Sweep)
			go runSweepLoop(2*time.Minute, ownershipWatcher.Sweep)

			maxFeeBps := parseUintEnv(getEnv("MARKETPLACE_MAX_FEE_BPS", "1000"), 1000)
			mux.HandleFunc("POST /api/marketplace/listings", marketplaceListingCreateHandler(marketplaceStore, registry, maxFeeBps))
			mux.HandleFunc("GET /api/marketplace/listings", marketplaceListingsGetHandler(marketplaceStore))
			mux.HandleFunc("POST /api/marketplace/trades", marketplaceTradeReserveHandler(marketplaceStore, escrowAddress))
			mux.HandleFunc("GET /api/marketplace/trades/{tradeID}", marketplaceTradeGetHandler(marketplaceStore))
			mux.HandleFunc("GET /api/marketplace/trades/by-wallet/{address}", marketplaceTradesByWalletHandler(marketplaceStore))
			mux.HandleFunc("POST /api/marketplace/trades/{tradeID}/release", marketplaceTradeReleaseHandler(marketplaceStore, rpc, registryAddress))
			mux.HandleFunc("POST /api/marketplace/trades/{tradeID}/claim", marketplaceTradeClaimHandler(marketplaceStore, rpc, registryAddress))
		}
	}

	log.Printf("NimConnect backend listening on :%s commit=%s build_time=%s", port, CommitHash, BuildTime)
	if err := http.ListenAndServe(":"+port, withRequestLogging(withCORS(allowedOrigin, mux))); err != nil {
		log.Fatal(err)
	}
}
