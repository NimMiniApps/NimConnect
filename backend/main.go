package main

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// secretEnv reads key from the environment, or from a mounted Docker/Swarm
// secret file at /run/secrets/<key> if the env var isn't set. Lets the same
// code work with a plain .env locally and Swarm secrets in production.
func secretEnv(key string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	data, err := os.ReadFile("/run/secrets/" + key)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
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

	databaseURL := secretEnv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = getEnv("DATABASE_URL", "")
	}
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	db, err := OpenDB(databaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()
	if err := Migrate(db); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	if _, err := ImportLegacyIfEmpty(db, LegacyPaths{
		Marketplace: getEnv("MARKETPLACE_FILE", "/data/marketplace.json"),
		Ledger:      getEnv("MARKETPLACE_LEDGER_FILE", "/data/marketplace_ledger.jsonl"),
		Stats:       getEnv("STATS_FILE", "/data/stats.json"),
		Handles:     getEnv("HANDLES_FILE", "/data/handles.json"),
		ProfilesDir: getEnv("PROFILES_DIR", "/data/profiles"),
		InboxDir:    getEnv("INBOX_DIR", "/data/inbox"),
	}); err != nil {
		log.Fatalf("legacy import: %v", err)
	}

	httpClient := &http.Client{Timeout: 10 * time.Second}

	ratesCache := NewRatesCache(60*time.Second, func() (RatesResponse, error) {
		return FetchRates(httpClient, coinGeckoBaseURL)
	})

	backupStore := NewBackupStore(backupDir)
	inboxStore := NewInboxStore(db)
	stats := NewStats(db)
	adminSessions := NewAdminSessions(parseAdminAddresses(getEnv("ADMIN_ADDRESSES", "")))
	userSessions := NewUserSessions()
	authStore := NewAuthStore(db)
	userSessions.scoped = authStore
	friendStore := NewFriendStore(db)
	friendLimiter := newFriendRequestLimiter(30, time.Hour)
	registryAddress := getEnv("REGISTRY_ADDRESS", NimfeedCatalogAddress)
	var registry *HandleRegistry
	var profiles *ProfileStore
	if registryAddress != "off" {
		reserved := loadReservedHandles(getEnv("RESERVED_HANDLES_FILE", "/data/reserved-handles.json"))
		releaseActivationHeight := parseActivationHeight(getEnv("RELEASE_ACTIVATION_HEIGHT", ""))
		registry = NewHandleRegistry(db, reserved, releaseActivationHeight)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", rootHandler)
	mux.HandleFunc("GET /api/health", healthHandler)
	mux.HandleFunc("GET /api/ready", readyHandler(db))
	mux.HandleFunc("GET /api/version", versionHandler)
	mux.HandleFunc("GET /api/rates", func(w http.ResponseWriter, r *http.Request) {
		stats.RecordOpen()
		ratesHandler(ratesCache)(w, r)
	})
	mux.HandleFunc("POST /api/admin/login", adminLoginHandler(adminSessions))
	mux.HandleFunc("POST /api/session", userSessionLoginHandler(userSessions))
	mux.HandleFunc("DELETE /api/session", userSessionLogoutHandler(userSessions))
	mux.HandleFunc("POST /api/auth/challenges", createAuthChallengeHandler(authStore))
	mux.HandleFunc("POST /api/auth/sessions", createAuthSessionHandler(authStore))
	mux.HandleFunc("GET /api/auth/session", authSessionInfoHandler(authStore))
	mux.HandleFunc("DELETE /api/auth/session", authSessionRevokeHandler(authStore))
	mux.HandleFunc("DELETE /api/auth/sessions", authSessionsRevokeAllHandler(authStore))
	mux.HandleFunc("GET /api/authorizations", authorizationsListHandler(userSessions, authStore))
	mux.HandleFunc("GET /api/admin/handles", adminHandlesHandler(adminSessions, registry))
	mux.HandleFunc("GET /api/stats", statsHandler(stats, adminSessions, registry))
	mux.HandleFunc("GET /api/backup/{address}", withWalletStat(stats, backupGetHandler(backupStore, authStore)))
	mux.HandleFunc("HEAD /api/backup/{address}", withWalletStat(stats, backupHeadHandler(backupStore, authStore)))
	mux.HandleFunc("PUT /api/backup/{address}", withWalletStat(stats, backupPutHandler(backupStore, authStore)))
	mux.HandleFunc("POST /api/inbox/messages", inboxPostHandler(inboxStore, authStore))
	mux.HandleFunc("GET /api/inbox/{address}/messages", withWalletStat(stats, inboxListHandler(inboxStore, authStore)))
	mux.HandleFunc("DELETE /api/inbox/{address}/messages/{id}", withWalletStat(stats, inboxDeleteHandler(inboxStore, authStore)))

	// On-chain handle registry — defaults to the shared NimFeed catalog address.
	if registry != nil {
		rpc := NewNimiqRPC(httpClient, getEnv("NIMIQ_RPC_URL", "https://rpc-mainnet.nimiqscan.com"))
		profiles = NewProfileStore(db)
		syncer := NewHandleSyncer(rpc, registry, registryAddress)
		go syncer.Run(2*time.Minute, make(chan struct{}))
		mux.HandleFunc("POST /api/admin/handles/resync", adminHandlesResyncHandler(adminSessions, registry, syncer))

		chainHeightCache := NewChainHeightCache(2*time.Second, rpc.GetBlockNumber)
		mux.HandleFunc("GET /api/chain/height", chainHeightHandler(chainHeightCache))
		mux.HandleFunc("GET /api/resolve/{handle}", resolveHandler(registry))
		mux.HandleFunc("GET /api/pay/resolve/{handle}", paymentResolveHandler(syncer, registry))
		mux.HandleFunc("GET /api/profile/{address}", profileGetHandler(profiles))
		mux.HandleFunc("PUT /api/profile/{address}", profilePutHandler(profiles, authStore))
		mux.HandleFunc("DELETE /api/profile/{address}", profileDeleteHandler(profiles, authStore))
		mux.HandleFunc("GET /api/handles/check", handleCheckHandler(registry))
		mux.HandleFunc("GET /api/handles/by-address/{address}", handleByAddressHandler(registry))
		mux.HandleFunc("POST /api/handles/claims", claimSubmitHandler(syncer, registry))

		publicOrigin := getEnv("PUBLIC_APP_ORIGIN", "https://nimconnect.nimiqminiapps.com")
		mux.HandleFunc("GET /p/{handle}", publicPageHandler(registry, profiles, publicOrigin))

		escrowAddress := getEnv("ESCROW_ADDRESS", "")
		if escrowAddress != "" {
			marketplaceStore := NewMarketplaceStore(db)
			ledger, err := OpenEscrowLedger(db)
			if err != nil {
				log.Fatalf("failed to open escrow ledger: %v", err)
			}
			// The escrow signer must be our own node, never a public gateway.
			// Network isolation (dedicated overlay, unpublished port) plus
			// mandatory RPC Basic Auth are both required (SEC-003).
			escrowSignerURL := getEnv("ESCROW_SIGNER_RPC_URL", "")
			walletKey := secretEnv("NIMIQ_WALLET_KEY")
			if escrowSignerURL == "" {
				log.Fatal("ESCROW_ADDRESS is set but ESCROW_SIGNER_RPC_URL is not — refusing to sign escrow payouts via a public gateway")
			}
			if walletKey == "" {
				log.Fatal("ESCROW_ADDRESS is set but NIMIQ_WALLET_KEY is not — cannot unlock the escrow account")
			}
			rpcUser, rpcPassword, err := requireEscrowSignerAuth(
				getEnv("ESCROW_SIGNER_RPC_USER", ""),
				secretEnv("ESCROW_SIGNER_RPC_PASSWORD"),
			)
			if err != nil {
				log.Fatal(err)
			}
			escrowSignerRPC := NewNimiqRPC(httpClient, escrowSignerURL).WithBasicAuth(rpcUser, rpcPassword)
			if err := SetupEscrowWallet(escrowSignerRPC, walletKey, escrowAddress, 3*time.Minute, 5*time.Second); err != nil {
				log.Fatalf("escrow wallet setup failed: %v", err)
			}
			settlement := NewSettlementWorker(marketplaceStore, ledger, escrowSignerRPC, escrowAddress)
			escrowWatcher := NewEscrowWatcher(rpc, marketplaceStore, escrowAddress)
			ownershipWatcher := NewOwnershipWatcher(rpc, marketplaceStore, registry, settlement)
			go runSweepLoop(2*time.Minute, escrowWatcher.Sweep)
			// UnlockAccount(..., 0) only holds "until the node restarts" — if
			// the node container restarts on its own (crash, restart policy)
			// after the one-time SetupEscrowWallet call above, the backend
			// would otherwise have no way to notice. Settle/Refund treat any
			// failed send as needing manual reconciliation rather than
			// retrying, so re-checking (and re-unlocking if needed) before
			// every sweep — not just once at startup — avoids ever attempting
			// a payout against a wallet that silently went locked.
			go runSweepLoop(2*time.Minute, func() error {
				if err := trySetupEscrowWallet(escrowSignerRPC, walletKey, escrowAddress); err != nil {
					return fmt.Errorf("escrow wallet not ready, skipping settlement sweep: %w", err)
				}
				return ownershipWatcher.Sweep()
			})
			// Expire unpaid reservations so listings cannot be held forever (SEC-005).
			go runSweepLoop(2*time.Minute, func() error {
				n, err := marketplaceStore.ExpireStaleReservations(time.Now().Unix())
				if err != nil {
					return err
				}
				if n > 0 {
					log.Printf("marketplace: expired %d unpaid reservation(s)", n)
				}
				return nil
			})

			maxFeeBps := parseUintEnv(getEnv("MARKETPLACE_MAX_FEE_BPS", "1000"), 1000)
			mux.HandleFunc("POST /api/marketplace/listings", marketplaceListingCreateHandler(marketplaceStore, registry, maxFeeBps, authStore))
			mux.HandleFunc("GET /api/marketplace/listings", marketplaceListingsGetHandler(marketplaceStore))
			mux.HandleFunc("POST /api/marketplace/trades", marketplaceTradeReserveHandler(marketplaceStore, escrowAddress, authStore))
			mux.HandleFunc("GET /api/marketplace/trades/{tradeID}", marketplaceTradeGetHandler(marketplaceStore))
			mux.HandleFunc("GET /api/marketplace/trades/by-wallet/{address}", marketplaceTradesByWalletHandler(marketplaceStore, authStore))
			mux.HandleFunc("POST /api/marketplace/trades/{tradeID}/cancel", marketplaceTradeCancelHandler(marketplaceStore, authStore))
			mux.HandleFunc("POST /api/marketplace/trades/{tradeID}/release", marketplaceTradeReleaseHandler(marketplaceStore, rpc, registryAddress))
			mux.HandleFunc("POST /api/marketplace/trades/{tradeID}/claim", marketplaceTradeClaimHandler(marketplaceStore, rpc, registryAddress))
			mux.HandleFunc("GET /api/admin/marketplace", adminMarketplaceHandler(adminSessions, marketplaceStore, ledger, rpc, escrowAddress))
		}
	}

	registerFriendsRoutes(mux, userSessions, friendStore, registry, profiles, friendLimiter)

	log.Printf("NimConnect backend listening on :%s commit=%s build_time=%s", port, CommitHash, BuildTime)
	if err := http.ListenAndServe(":"+port, withRequestLogging(withCORS(allowedOrigin, mux, authStore))); err != nil {
		log.Fatal(err)
	}
}
