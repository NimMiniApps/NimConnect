package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const (
	awardIDMaxLen          = 128
	awardTitleMaxLen       = 128
	awardDescriptionMaxLen = 500
	awardRarityMaxLen      = 32
	awardProgressMaxBytes  = 1024
)

type Award struct {
	AppID         string
	AchievementID string
	Address       string
	Title         string
	Description   string
	Rarity        string
	Progress      json.RawMessage
	Visibility    string
	GrantedAt     time.Time
}

type AwardStore struct {
	db *sql.DB
}

func NewAwardStore(db *sql.DB) *AwardStore {
	return &AwardStore{db: db}
}

// rarity and progress are app-declared and untrusted — stored and returned
// verbatim, never validated against any game state.
func validateAward(a Award) error {
	if !isValidNimiqAddress(a.Address) {
		return errBadRequest
	}
	if a.AchievementID == "" || len(a.AchievementID) > awardIDMaxLen {
		return errBadRequest
	}
	if a.Title == "" || len(a.Title) > awardTitleMaxLen {
		return errBadRequest
	}
	if len(a.Description) > awardDescriptionMaxLen || len(a.Rarity) > awardRarityMaxLen {
		return errBadRequest
	}
	if len(a.Progress) > awardProgressMaxBytes {
		return errBadRequest
	}
	if a.Progress != nil && !json.Valid(a.Progress) {
		return errBadRequest
	}
	switch a.Visibility {
	case "", "public", "private":
	default:
		return errBadRequest
	}
	return nil
}

// Grant records an award, idempotent on (app_id, achievement_id, address):
// a retry or an app replaying its history is harmless and returns the same
// stored row rather than erroring.
func (s *AwardStore) Grant(a Award) (Award, error) {
	if err := validateAward(a); err != nil {
		return Award{}, err
	}
	if a.Visibility == "" {
		a.Visibility = "public"
	}
	address := compactAddress(a.Address)
	var progress any
	if a.Progress != nil {
		progress = []byte(a.Progress)
	}

	_, err := s.db.Exec(`
		INSERT INTO awards (app_id, achievement_id, address, title, description, rarity, progress, visibility)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (app_id, achievement_id, address) DO NOTHING`,
		a.AppID, a.AchievementID, address, a.Title, a.Description, a.Rarity, progress, a.Visibility)
	if err != nil {
		return Award{}, fmt.Errorf("grant award: %w", err)
	}

	stored, err := s.get(a.AppID, a.AchievementID, address)
	if err != nil {
		return Award{}, fmt.Errorf("read granted award: %w", err)
	}
	return stored, nil
}

func (s *AwardStore) get(appID, achievementID, address string) (Award, error) {
	var a Award
	var progress []byte
	err := s.db.QueryRow(`
		SELECT app_id, achievement_id, address, title, description, rarity, progress, visibility, granted_at
		FROM awards WHERE app_id = $1 AND achievement_id = $2 AND address = $3`,
		appID, achievementID, address).
		Scan(&a.AppID, &a.AchievementID, &a.Address, &a.Title, &a.Description, &a.Rarity, &progress, &a.Visibility, &a.GrantedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Award{}, errNotFound
	}
	if err != nil {
		return Award{}, err
	}
	a.Address = normalizeAddress(a.Address)
	a.Progress = progress
	a.GrantedAt = a.GrantedAt.UTC()
	return a, nil
}

// ListForAddress returns a wallet's awards, newest first. includePrivate is
// true only when the caller is the wallet itself (or an app it granted
// achievements:read to) — otherwise private awards must not leak onto a
// public profile panel.
func (s *AwardStore) ListForAddress(address string, includePrivate bool) ([]Award, error) {
	if !isValidNimiqAddress(address) {
		return nil, errBadRequest
	}
	query := `
		SELECT app_id, achievement_id, address, title, description, rarity, progress, visibility, granted_at
		FROM awards WHERE address = $1`
	if !includePrivate {
		query += ` AND visibility = 'public'`
	}
	query += ` ORDER BY granted_at DESC`

	rows, err := s.db.Query(query, compactAddress(address))
	if err != nil {
		return nil, fmt.Errorf("list awards: %w", err)
	}
	defer rows.Close()

	var awards []Award
	for rows.Next() {
		var a Award
		var progress []byte
		if err := rows.Scan(&a.AppID, &a.AchievementID, &a.Address, &a.Title, &a.Description, &a.Rarity, &progress, &a.Visibility, &a.GrantedAt); err != nil {
			return nil, fmt.Errorf("scan award: %w", err)
		}
		a.Address = normalizeAddress(a.Address)
		a.Progress = progress
		a.GrantedAt = a.GrantedAt.UTC()
		awards = append(awards, a)
	}
	return awards, rows.Err()
}
