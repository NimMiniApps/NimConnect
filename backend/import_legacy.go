package main

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// LegacyPaths points at the on-disk JSON state written by the pre-Postgres backend.
type LegacyPaths struct {
	Marketplace, Ledger, Stats, Handles, ProfilesDir, InboxDir string
}

type legacyMarketplaceSnapshot struct {
	Listings map[string]MarketplaceListing `json:"listings"`
	Trades   map[string]MarketplaceTrade   `json:"trades"`
	Nonces   map[string]bool               `json:"nonces"`
}

type legacyStatsFile struct {
	Days map[string]*DayStats `json:"days"`
}

// ImportLegacyIfEmpty imports legacy JSON/JSONL state when Postgres has no app data yet.
// Missing source files are skipped; corrupt files abort the import and leave sources untouched.
// Successfully imported sources are renamed to *.imported-<unix> beside the original path.
func ImportLegacyIfEmpty(db *sql.DB, paths LegacyPaths) (imported bool, err error) {
	empty, err := legacyDBEmpty(db)
	if err != nil {
		return false, err
	}
	if !empty {
		return false, nil
	}

	snapshot, marketplaceSrc, err := readLegacyMarketplace(paths.Marketplace)
	if err != nil {
		return false, err
	}
	ledger, ledgerSrc, err := readLegacyLedger(paths.Ledger)
	if err != nil {
		return false, err
	}
	statsDays, statsSrc, err := readLegacyStats(paths.Stats)
	if err != nil {
		return false, err
	}
	handles, handlesSrc, err := readLegacyHandles(paths.Handles)
	if err != nil {
		return false, err
	}
	profiles, profileSources, err := readLegacyProfiles(paths.ProfilesDir)
	if err != nil {
		return false, err
	}
	inbox, inboxSources, err := readLegacyInbox(paths.InboxDir)
	if err != nil {
		return false, err
	}

	sources := make([]string, 0)
	if marketplaceSrc != "" {
		sources = append(sources, marketplaceSrc)
	}
	if ledgerSrc != "" {
		sources = append(sources, ledgerSrc)
	}
	if statsSrc != "" {
		sources = append(sources, statsSrc)
	}
	if handlesSrc != "" {
		sources = append(sources, handlesSrc)
	}
	sources = append(sources, profileSources...)
	sources = append(sources, inboxSources...)

	if len(sources) == 0 {
		return false, nil
	}

	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	if err := importLegacyMarketplace(tx, snapshot); err != nil {
		return false, err
	}
	if err := importLegacyLedger(tx, ledger); err != nil {
		return false, err
	}
	if err := importLegacyStats(tx, statsDays); err != nil {
		return false, err
	}
	if err := importLegacyHandles(tx, handles); err != nil {
		return false, err
	}
	if err := importLegacyProfiles(tx, profiles); err != nil {
		return false, err
	}
	if err := importLegacyInbox(tx, inbox); err != nil {
		return false, err
	}

	if err := tx.Commit(); err != nil {
		return false, err
	}

	stamp := time.Now().Unix()
	for _, src := range sources {
		if err := renameImported(src, stamp); err != nil {
			return true, fmt.Errorf("legacy import committed but rename %q: %w", src, err)
		}
	}
	return true, nil
}

func legacyDBEmpty(db *sql.DB) (bool, error) {
	var n int
	err := db.QueryRow(`
		SELECT CASE WHEN EXISTS (SELECT 1 FROM marketplace_trades LIMIT 1) THEN 1 ELSE 0 END
		     + CASE WHEN EXISTS (SELECT 1 FROM marketplace_listings LIMIT 1) THEN 1 ELSE 0 END
		     + CASE WHEN EXISTS (SELECT 1 FROM profiles LIMIT 1) THEN 1 ELSE 0 END
		     + CASE WHEN EXISTS (SELECT 1 FROM handle_claims LIMIT 1) THEN 1 ELSE 0 END
		     + CASE WHEN EXISTS (SELECT 1 FROM stats_days LIMIT 1) THEN 1 ELSE 0 END
		     + CASE WHEN EXISTS (SELECT 1 FROM inbox_messages LIMIT 1) THEN 1 ELSE 0 END`,
	).Scan(&n)
	return n == 0, err
}

func readLegacyMarketplace(path string) (legacyMarketplaceSnapshot, string, error) {
	data, found, err := readLegacyFile(path)
	if err != nil || !found {
		return legacyMarketplaceSnapshot{}, "", err
	}
	var snapshot legacyMarketplaceSnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return legacyMarketplaceSnapshot{}, path, fmt.Errorf("decode marketplace %q: %w", path, err)
	}
	return snapshot, path, nil
}

func readLegacyLedger(path string) ([]LedgerEntry, string, error) {
	data, found, err := readLegacyFile(path)
	if err != nil || !found {
		return nil, "", err
	}
	entries := make([]LedgerEntry, 0)
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry LedgerEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			return nil, path, fmt.Errorf("decode ledger %q line %d: %w", path, lineNo, err)
		}
		entries = append(entries, entry)
	}
	if err := scanner.Err(); err != nil {
		return nil, path, fmt.Errorf("read ledger %q: %w", path, err)
	}
	return entries, path, nil
}

func readLegacyStats(path string) (map[string]*DayStats, string, error) {
	data, found, err := readLegacyFile(path)
	if err != nil || !found {
		return nil, "", err
	}
	var file legacyStatsFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, path, fmt.Errorf("decode stats %q: %w", path, err)
	}
	if file.Days == nil {
		file.Days = map[string]*DayStats{}
	}
	return file.Days, path, nil
}

func readLegacyHandles(path string) (map[string]HandleClaim, string, error) {
	data, found, err := readLegacyFile(path)
	if err != nil || !found {
		return nil, "", err
	}
	var handles map[string]HandleClaim
	if err := json.Unmarshal(data, &handles); err != nil {
		return nil, path, fmt.Errorf("decode handles %q: %w", path, err)
	}
	if handles == nil {
		handles = map[string]HandleClaim{}
	}
	return handles, path, nil
}

func readLegacyProfiles(dir string) ([]StoredProfile, []string, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("read profiles dir %q: %w", dir, err)
	}
	profiles := make([]StoredProfile, 0, len(entries))
	sources := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, nil, fmt.Errorf("read profile %q: %w", path, err)
		}
		var profile StoredProfile
		if err := json.Unmarshal(data, &profile); err != nil {
			return nil, nil, fmt.Errorf("decode profile %q: %w", path, err)
		}
		profiles = append(profiles, profile)
		sources = append(sources, path)
	}
	return profiles, sources, nil
}

func readLegacyInbox(dir string) ([]InboxMessage, []string, error) {
	mailboxes, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("read inbox dir %q: %w", dir, err)
	}
	msgs := make([]InboxMessage, 0)
	sources := make([]string, 0)
	for _, mailbox := range mailboxes {
		if !mailbox.IsDir() {
			continue
		}
		mailboxDir := filepath.Join(dir, mailbox.Name())
		files, err := os.ReadDir(mailboxDir)
		if err != nil {
			return nil, nil, fmt.Errorf("read inbox mailbox %q: %w", mailboxDir, err)
		}
		for _, file := range files {
			name := file.Name()
			if file.IsDir() || !strings.HasSuffix(name, ".json") {
				continue
			}
			id := strings.TrimSuffix(name, ".json")
			if !isMessageID(id) {
				continue
			}
			path := filepath.Join(mailboxDir, name)
			data, err := os.ReadFile(path)
			if err != nil {
				return nil, nil, fmt.Errorf("read inbox message %q: %w", path, err)
			}
			var msg InboxMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				return nil, nil, fmt.Errorf("decode inbox message %q: %w", path, err)
			}
			msgs = append(msgs, msg)
			sources = append(sources, path)
		}
	}
	return msgs, sources, nil
}

func readLegacyFile(path string) ([]byte, bool, error) {
	if path == "" {
		return nil, false, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("read %q: %w", path, err)
	}
	return data, true, nil
}

func importLegacyMarketplace(tx *sql.Tx, snapshot legacyMarketplaceSnapshot) error {
	for _, listing := range snapshot.Listings {
		if _, err := tx.Exec(`
			INSERT INTO marketplace_listings (
				handle, seller, price_luna, fee_luna, status, ownership_epoch_tx_hash, created_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			listing.Handle, compactAddress(listing.Seller), int64(listing.PriceLuna), int64(listing.FeeLuna),
			listing.Status, listing.OwnershipEpochTxHash, listing.CreatedAt,
		); err != nil {
			return fmt.Errorf("import marketplace listing %q: %w", listing.Handle, err)
		}
	}
	for _, trade := range snapshot.Trades {
		if _, err := tx.Exec(`
			INSERT INTO marketplace_trades (
				id, reference, handle, buyer, seller, price_luna, fee_luna, escrow_address, state, version,
				deposit_tx_hash, deposit_block_height, release_tx_hash, claim_tx_hash,
				payout_attempted_at, payout_tx_hash, refund_attempted_at, refund_tx_hash,
				deposit_deadline, created_at, updated_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
			trade.ID, trade.Reference, trade.Handle,
			compactAddress(trade.Buyer), compactAddress(trade.Seller),
			int64(trade.PriceLuna), int64(trade.FeeLuna), trade.EscrowAddress, string(trade.State), int64(trade.Version),
			trade.DepositTxHash, int64(trade.DepositBlockHeight), trade.ReleaseTxHash, trade.ClaimTxHash,
			trade.PayoutAttemptedAt, trade.PayoutTxHash, trade.RefundAttemptedAt, trade.RefundTxHash,
			trade.DepositDeadline, trade.CreatedAt, trade.UpdatedAt,
		); err != nil {
			return fmt.Errorf("import marketplace trade %q: %w", trade.ID, err)
		}
	}
	for nonce := range snapshot.Nonces {
		if _, err := tx.Exec(`INSERT INTO marketplace_nonces (nonce) VALUES ($1)`, nonce); err != nil {
			return fmt.Errorf("import marketplace nonce %q: %w", nonce, err)
		}
	}
	return nil
}

func importLegacyLedger(tx *sql.Tx, entries []LedgerEntry) error {
	for _, entry := range entries {
		if _, err := tx.Exec(`
			INSERT INTO escrow_ledger (sequence, trade_id, type, amount_luna, tx_hash, timestamp)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			entry.Sequence, entry.TradeID, string(entry.Type), entry.AmountLuna, entry.TxHash, entry.Timestamp,
		); err != nil {
			return fmt.Errorf("import ledger entry seq %d: %w", entry.Sequence, err)
		}
	}
	if len(entries) == 0 {
		return nil
	}
	if _, err := tx.Exec(`
		SELECT setval(
			pg_get_serial_sequence('escrow_ledger', 'sequence'),
			COALESCE((SELECT MAX(sequence) FROM escrow_ledger), 1)
		)`); err != nil {
		return fmt.Errorf("reset escrow ledger sequence: %w", err)
	}
	return nil
}

func importLegacyStats(tx *sql.Tx, days map[string]*DayStats) error {
	for day, stats := range days {
		if stats == nil {
			continue
		}
		if _, err := tx.Exec(`
			INSERT INTO stats_days (day, opens) VALUES ($1::date, $2)
			ON CONFLICT (day) DO UPDATE SET opens = EXCLUDED.opens`,
			day, stats.Opens,
		); err != nil {
			return fmt.Errorf("import stats day %q: %w", day, err)
		}
		if stats.Wallets == nil {
			continue
		}
		for addr := range stats.Wallets {
			if _, err := tx.Exec(`
				INSERT INTO stats_day_wallets (day, address) VALUES ($1::date, $2)
				ON CONFLICT DO NOTHING`, day, compactAddress(addr),
			); err != nil {
				return fmt.Errorf("import stats wallet %q on %q: %w", addr, day, err)
			}
		}
	}
	return nil
}

func importLegacyHandles(tx *sql.Tx, handles map[string]HandleClaim) error {
	for _, claim := range handles {
		if _, err := tx.Exec(`
			INSERT INTO handle_claims (handle, address, tx_hash, block_height, tx_index, claimed_at)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			claim.Handle, compactAddress(claim.Address), claim.TxHash,
			int64(claim.BlockHeight), int64(claim.TxIndex), claim.ClaimedAt,
		); err != nil {
			return fmt.Errorf("import handle claim %q: %w", claim.Handle, err)
		}
	}
	return nil
}

func importLegacyProfiles(tx *sql.Tx, profiles []StoredProfile) error {
	for _, profile := range profiles {
		if _, err := tx.Exec(`
			INSERT INTO profiles (address, payload, updated_at, public_key, signature)
			VALUES ($1, $2, $3, $4, $5)`,
			compactAddress(profile.Address), profile.Profile, profile.UpdatedAt,
			profile.PublicKey, profile.Signature,
		); err != nil {
			return fmt.Errorf("import profile %q: %w", profile.Address, err)
		}
	}
	return nil
}

func importLegacyInbox(tx *sql.Tx, msgs []InboxMessage) error {
	for _, msg := range msgs {
		if _, err := tx.Exec(`
			INSERT INTO inbox_messages (
				id, version, type, object_id, nonce, sender, recipient,
				payload, sent_at, received_at, public_key, signature
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			msg.ID, msg.Version, msg.Type, msg.ObjectID, msg.Nonce,
			compactAddress(msg.Sender), compactAddress(msg.Recipient),
			msg.Payload, msg.SentAt, msg.ReceivedAt, msg.PublicKey, msg.Signature,
		); err != nil {
			return fmt.Errorf("import inbox message %q: %w", msg.ID, err)
		}
	}
	return nil
}

func renameImported(path string, stamp int64) error {
	return os.Rename(path, fmt.Sprintf("%s.imported-%d", path, stamp))
}
