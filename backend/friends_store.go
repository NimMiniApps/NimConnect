package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"
)

type FriendshipStatus string

const (
	FriendshipPending  FriendshipStatus = "pending"
	FriendshipAccepted FriendshipStatus = "accepted"
	FriendshipDeclined FriendshipStatus = "declined"
)

type Friendship struct {
	ID               string           `json:"id"`
	RequesterAddress string           `json:"requester_address"`
	RecipientAddress string           `json:"recipient_address"`
	Status           FriendshipStatus `json:"status"`
	CreatedAt        int64            `json:"created_at"`
	UpdatedAt        int64            `json:"updated_at"`
}

// FriendStore persists the mutual-friends graph in Postgres (`friendships`).
type FriendStore struct {
	db       *sql.DB
	now      func() time.Time
	randRead func([]byte) (int, error)
}

func NewFriendStore(db *sql.DB) *FriendStore {
	return &FriendStore{
		db:       db,
		now:      time.Now,
		randRead: rand.Read,
	}
}

func (s *FriendStore) newID() (string, error) {
	buf := make([]byte, 16)
	if _, err := s.randRead(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func scanFriendship(row interface{ Scan(...any) error }) (Friendship, error) {
	var f Friendship
	var status string
	err := row.Scan(&f.ID, &f.RequesterAddress, &f.RecipientAddress, &status, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		return Friendship{}, err
	}
	f.Status = FriendshipStatus(status)
	return f, nil
}

func (s *FriendStore) findPair(tx *sql.Tx, a, b string) (Friendship, error) {
	row := tx.QueryRow(`
		SELECT id, requester_address, recipient_address, status, created_at, updated_at
		FROM friendships
		WHERE LEAST(requester_address, recipient_address) = LEAST($1, $2)
		  AND GREATEST(requester_address, recipient_address) = GREATEST($1, $2)
		ORDER BY
			CASE status
				WHEN 'pending' THEN 0
				WHEN 'accepted' THEN 1
				ELSE 2
			END,
			updated_at DESC
		LIMIT 1
		FOR UPDATE`, a, b)
	f, err := scanFriendship(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Friendship{}, errNotFound
	}
	return f, err
}

func (s *FriendStore) SendRequest(from, to string) (Friendship, error) {
	from = compactAddress(from)
	to = compactAddress(to)
	if from == "" || to == "" {
		return Friendship{}, errBadRequest
	}
	if from == to {
		return Friendship{}, errBadRequest
	}

	tx, err := s.db.Begin()
	if err != nil {
		return Friendship{}, err
	}
	defer func() { _ = tx.Rollback() }()

	now := s.now().Unix()
	existing, err := s.findPair(tx, from, to)
	if err != nil && !errors.Is(err, errNotFound) {
		return Friendship{}, err
	}
	if err == nil {
		switch existing.Status {
		case FriendshipPending, FriendshipAccepted:
			return Friendship{}, errConflict
		case FriendshipDeclined:
			existing.RequesterAddress = from
			existing.RecipientAddress = to
			existing.Status = FriendshipPending
			existing.UpdatedAt = now
			_, err = tx.Exec(`
				UPDATE friendships
				SET requester_address = $2, recipient_address = $3, status = $4, updated_at = $5
				WHERE id = $1`,
				existing.ID, from, to, string(FriendshipPending), now,
			)
			if err != nil {
				return Friendship{}, err
			}
			if err := tx.Commit(); err != nil {
				return Friendship{}, err
			}
			return existing, nil
		}
	}

	id, err := s.newID()
	if err != nil {
		return Friendship{}, err
	}
	f := Friendship{
		ID:               id,
		RequesterAddress: from,
		RecipientAddress: to,
		Status:           FriendshipPending,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	_, err = tx.Exec(`
		INSERT INTO friendships (id, requester_address, recipient_address, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		f.ID, f.RequesterAddress, f.RecipientAddress, string(f.Status), f.CreatedAt, f.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return Friendship{}, errConflict
		}
		return Friendship{}, err
	}
	if err := tx.Commit(); err != nil {
		return Friendship{}, err
	}
	return f, nil
}

func (s *FriendStore) Accept(id, actor string) (Friendship, error) {
	return s.setPendingStatus(id, actor, FriendshipAccepted)
}

func (s *FriendStore) Decline(id, actor string) (Friendship, error) {
	return s.setPendingStatus(id, actor, FriendshipDeclined)
}

func (s *FriendStore) setPendingStatus(id, actor string, status FriendshipStatus) (Friendship, error) {
	actor = compactAddress(actor)
	tx, err := s.db.Begin()
	if err != nil {
		return Friendship{}, err
	}
	defer func() { _ = tx.Rollback() }()

	row := tx.QueryRow(`
		SELECT id, requester_address, recipient_address, status, created_at, updated_at
		FROM friendships WHERE id = $1 FOR UPDATE`, id)
	f, err := scanFriendship(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Friendship{}, errNotFound
	}
	if err != nil {
		return Friendship{}, err
	}
	if f.Status != FriendshipPending {
		return Friendship{}, errNotFound
	}
	if compactAddress(f.RecipientAddress) != actor {
		return Friendship{}, errUnauthorized
	}
	f.Status = status
	f.UpdatedAt = s.now().Unix()
	_, err = tx.Exec(`UPDATE friendships SET status = $2, updated_at = $3 WHERE id = $1`,
		f.ID, string(status), f.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return Friendship{}, errConflict
		}
		return Friendship{}, err
	}
	if err := tx.Commit(); err != nil {
		return Friendship{}, err
	}
	return f, nil
}

func (s *FriendStore) Remove(actor, other string) error {
	actor = compactAddress(actor)
	other = compactAddress(other)

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	f, err := s.findPair(tx, actor, other)
	if errors.Is(err, errNotFound) || (err == nil && f.Status != FriendshipAccepted) {
		return errNotFound
	}
	if err != nil {
		return err
	}
	if compactAddress(f.RequesterAddress) != actor && compactAddress(f.RecipientAddress) != actor {
		return errUnauthorized
	}
	if _, err := tx.Exec(`DELETE FROM friendships WHERE id = $1`, f.ID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *FriendStore) ListFriends(actor string) ([]Friendship, error) {
	return s.listByStatus(actor, FriendshipAccepted)
}

func (s *FriendStore) ListRequests(actor string) ([]Friendship, error) {
	return s.listByStatus(actor, FriendshipPending)
}

func (s *FriendStore) listByStatus(actor string, status FriendshipStatus) ([]Friendship, error) {
	actor = compactAddress(actor)
	rows, err := s.db.Query(`
		SELECT id, requester_address, recipient_address, status, created_at, updated_at
		FROM friendships
		WHERE status = $1
		  AND (requester_address = $2 OR recipient_address = $2)
		ORDER BY updated_at DESC, id`, string(status), actor)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Friendship, 0)
	for rows.Next() {
		f, err := scanFriendship(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
