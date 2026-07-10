package main

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type InboxStore struct {
	dir   string
	now   func() time.Time
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func NewInboxStore(dir string) *InboxStore {
	return &InboxStore{dir: dir, now: time.Now, locks: map[string]*sync.Mutex{}}
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

func (s *InboxStore) mailboxDir(compact string) string {
	return filepath.Join(s.dir, compact)
}

// readMailbox parses all messages in a mailbox. Callers hold the mailbox lock.
// Skips symlinks, non-message filenames, and corrupt files (quarantined as .corrupt).
func (s *InboxStore) readMailbox(compact string) ([]InboxMessage, error) {
	dir := s.mailboxDir(compact)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(entries) > inboxMaxDirEntries {
		entries = entries[:inboxMaxDirEntries]
	}
	var msgs []InboxMessage
	for _, e := range entries {
		name := e.Name()
		if e.Type()&os.ModeSymlink != 0 {
			log.Printf("inbox: skipping symlink mailbox=%q name=%q", compact, name)
			continue
		}
		if filepath.Ext(name) != ".json" || !isMessageID(name[:len(name)-len(".json")]) {
			continue
		}
		path := filepath.Join(dir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			log.Printf("inbox: unreadable file mailbox=%q name=%q err=%q", compact, name, err)
			continue
		}
		var msg InboxMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Printf("inbox: quarantining corrupt file mailbox=%q name=%q err=%q", compact, name, err)
			_ = os.Rename(path, path+".corrupt")
			continue
		}
		msgs = append(msgs, msg)
	}
	return msgs, nil
}

func (s *InboxStore) writeMessage(compact string, msg InboxMessage) error {
	dir := s.mailboxDir(compact)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	path := filepath.Join(dir, msg.ID+".json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *InboxStore) Put(req InboxSendRequest) (string, bool, error) {
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
	if req.PublicKey == "" || req.Signature == "" || req.SentAt <= 0 {
		return "", false, errBadRequest
	}

	msg := inboxSendMessage(req.Sender, req.Recipient, req.SentAt, req.Nonce, req.ObjectID, sha256Hex(req.Payload))
	if err := verifySignedMessage(req.Sender, req.PublicKey, req.Signature, msg); err != nil {
		return "", false, errUnauthorized
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

	existing, err := s.readMailbox(recipient)
	if err != nil {
		return "", false, err
	}
	fromSender := 0
	for _, m := range existing {
		if compactAddress(m.Sender) == sender {
			if m.Nonce == req.Nonce {
				return m.ID, true, nil // idempotent replay
			}
			fromSender++
		}
	}
	if len(existing) >= inboxMaxMailbox || fromSender >= inboxMaxPerSender {
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
	}
	if err := s.writeMessage(recipient, stored); err != nil {
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

	msgs, err := s.readMailbox(compact)
	if err != nil {
		return nil, err
	}
	cutoff := s.now().Add(-inboxRetention).UnixMilli()
	live := make([]InboxMessage, 0, len(msgs))
	for _, m := range msgs {
		if m.ReceivedAt < cutoff {
			_ = os.Remove(filepath.Join(s.mailboxDir(compact), m.ID+".json"))
			continue
		}
		live = append(live, m)
	}
	sort.Slice(live, func(i, j int) bool { return live[i].ReceivedAt < live[j].ReceivedAt })
	return live, nil
}

func (s *InboxStore) Delete(address, id string) error {
	if !isValidNimiqAddress(address) || !isMessageID(id) {
		return errBadRequest
	}
	compact := compactAddress(address)
	lock := s.lock(compact)
	lock.Lock()
	defer lock.Unlock()

	err := os.Remove(filepath.Join(s.mailboxDir(compact), id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return errNotFound
	}
	return err
}
