package main

import (
	"database/sql"
	"errors"
	"sort"
	"sync"
	"time"
)

type InboxStore struct {
	db    *sql.DB
	now   func() time.Time
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func NewInboxStore(db *sql.DB) *InboxStore {
	return &InboxStore{db: db, now: time.Now, locks: map[string]*sync.Mutex{}}
}

// lock returns the mutex for one mailbox, creating it on first use.
func (s *InboxStore) lock(compact string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.locks[compact] == nil {
		s.locks[compact] = &sync.Mutex{}
	}
	return s.locks[compact]
}

const inboxSelectCols = `id, version, type, object_id, nonce, sender, recipient,
	payload, sent_at, received_at, COALESCE(public_key, ''), COALESCE(signature, ''),
	auth_mode, COALESCE(auth_session_id, ''), COALESCE(auth_audience, '')`

func scanInboxMessage(row interface{ Scan(...any) error }) (InboxMessage, error) {
	var m InboxMessage
	var sender, recipient string
	err := row.Scan(
		&m.ID, &m.Version, &m.Type, &m.ObjectID, &m.Nonce,
		&sender, &recipient, &m.Payload, &m.SentAt, &m.ReceivedAt,
		&m.PublicKey, &m.Signature, &m.AuthMode, &m.AuthSessionID, &m.AuthAudience,
	)
	if err != nil {
		return InboxMessage{}, err
	}
	m.Sender = normalizeAddress(sender)
	m.Recipient = normalizeAddress(recipient)
	return m, nil
}

func (s *InboxStore) findBySenderNonce(sender, nonce string) (string, error) {
	var id string
	err := s.db.QueryRow(`
		SELECT id FROM inbox_messages WHERE sender = $1 AND nonce = $2`,
		sender, nonce).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNotFound
	}
	return id, err
}

func (s *InboxStore) Put(req InboxSendRequest) (string, bool, error) {
	return s.put(req, "wallet_signature", "", "", true)
}

func (s *InboxStore) PutAuthorized(actor string, req InboxSendRequest, grant AuthGrant) (string, bool, error) {
	req.Sender = actor
	return s.put(req, "scoped_session", grant.ID, grant.Audience, false)
}

func (s *InboxStore) put(req InboxSendRequest, authMode, authSessionID, authAudience string, verifySignature bool) (string, bool, error) {
	if req.Version != 1 || req.Type != "payment-request" {
		return "", false, errBadRequest
	}
	if req.ObjectID == "" || len(req.ObjectID) > 128 {
		return "", false, errBadRequest
	}
	if !isInboxNonce(req.Nonce) {
		return "", false, errBadRequest
	}
	if req.Payload == "" || len(req.Payload) > inboxMaxPayloadBytes {
		return "", false, errBadRequest
	}
	if !isValidNimiqAddress(req.Sender) || !isValidNimiqAddress(req.Recipient) {
		return "", false, errBadRequest
	}
	if req.SentAt <= 0 || (verifySignature && (req.PublicKey == "" || req.Signature == "")) {
		return "", false, errBadRequest
	}

	if verifySignature {
		msg := inboxSendMessage(req.Sender, req.Recipient, req.SentAt, req.Nonce, req.ObjectID, sha256Hex(req.Payload))
		if err := verifySignedMessage(req.Sender, req.PublicKey, req.Signature, msg); err != nil {
			return "", false, errUnauthorized
		}
	}

	now := s.now()
	windowMs := int64(inboxSendWindow / time.Millisecond)
	drift := now.UnixMilli() - req.SentAt
	if drift > windowMs || drift < -windowMs {
		return "", false, errConflict
	}

	recipient := compactAddress(req.Recipient)
	sender := compactAddress(req.Sender)
	lock := s.lock(recipient)
	lock.Lock()
	defer lock.Unlock()

	if id, err := s.findBySenderNonce(sender, req.Nonce); err == nil {
		return id, true, nil
	} else if !errors.Is(err, errNotFound) {
		return "", false, err
	}

	var total, fromSender int
	if err := s.db.QueryRow(`
		SELECT COUNT(*) FROM inbox_messages WHERE recipient = $1`, recipient).Scan(&total); err != nil {
		return "", false, err
	}
	if err := s.db.QueryRow(`
		SELECT COUNT(*) FROM inbox_messages WHERE recipient = $1 AND sender = $2`,
		recipient, sender).Scan(&fromSender); err != nil {
		return "", false, err
	}
	if total >= inboxMaxMailbox || fromSender >= inboxMaxPerSender {
		return "", false, errTooMany
	}

	stored := InboxMessage{
		Version:    req.Version,
		Type:       req.Type,
		ID:         newMessageID(),
		ObjectID:   req.ObjectID,
		Nonce:      req.Nonce,
		Sender:     normalizeAddress(req.Sender),
		Recipient:  normalizeAddress(req.Recipient),
		Payload:    req.Payload,
		SentAt:     req.SentAt,
		ReceivedAt: now.UnixMilli(),
		PublicKey:  req.PublicKey,
		Signature:  req.Signature,
		AuthMode:   authMode, AuthSessionID: authSessionID, AuthAudience: authAudience,
	}
	_, err := s.db.Exec(`
		INSERT INTO inbox_messages (
			id, version, type, object_id, nonce, sender, recipient,
			payload, sent_at, received_at, public_key, signature, auth_mode, auth_session_id, auth_audience
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		stored.ID, stored.Version, stored.Type, stored.ObjectID, stored.Nonce,
		sender, recipient, stored.Payload, stored.SentAt, stored.ReceivedAt,
		stored.PublicKey, stored.Signature, stored.AuthMode, stored.AuthSessionID, stored.AuthAudience,
	)
	if isUniqueViolation(err) {
		id, lookupErr := s.findBySenderNonce(sender, req.Nonce)
		if lookupErr != nil {
			return "", false, lookupErr
		}
		return id, true, nil
	}
	if err != nil {
		return "", false, err
	}
	return stored.ID, false, nil
}

func (s *InboxStore) List(address string) ([]InboxMessage, error) {
	if !isValidNimiqAddress(address) {
		return nil, errBadRequest
	}
	compact := compactAddress(address)
	lock := s.lock(compact)
	lock.Lock()
	defer lock.Unlock()

	cutoff := s.now().Add(-inboxRetention).UnixMilli()
	if _, err := s.db.Exec(`
		DELETE FROM inbox_messages WHERE recipient = $1 AND received_at < $2`,
		compact, cutoff); err != nil {
		return nil, err
	}

	rows, err := s.db.Query(`
		SELECT `+inboxSelectCols+`
		FROM inbox_messages
		WHERE recipient = $1
		ORDER BY received_at ASC`, compact)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	msgs := make([]InboxMessage, 0)
	for rows.Next() {
		m, err := scanInboxMessage(rows)
		if err != nil {
			return nil, err
		}
		msgs = append(msgs, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(msgs, func(i, j int) bool { return msgs[i].ReceivedAt < msgs[j].ReceivedAt })
	return msgs, nil
}

func (s *InboxStore) Delete(address, id string) error {
	if !isValidNimiqAddress(address) || !isMessageID(id) {
		return errBadRequest
	}
	compact := compactAddress(address)
	lock := s.lock(compact)
	lock.Lock()
	defer lock.Unlock()

	res, err := s.db.Exec(`
		DELETE FROM inbox_messages WHERE recipient = $1 AND id = $2`, compact, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return errNotFound
	}
	return nil
}
