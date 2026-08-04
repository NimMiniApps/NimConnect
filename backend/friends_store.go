package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"sync"
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

type FriendStore struct {
	path     string
	mu       sync.Mutex
	now      func() time.Time
	randRead func([]byte) (int, error)
	byID     map[string]Friendship
}

type friendStoreSnapshot struct {
	Friendships map[string]Friendship `json:"friendships"`
}

func NewFriendStore(path string) *FriendStore {
	s := &FriendStore{
		path:     path,
		now:      time.Now,
		randRead: rand.Read,
		byID:     map[string]Friendship{},
	}
	if data, err := readFileIfExists(path); err == nil && data != nil {
		var snapshot friendStoreSnapshot
		if json.Unmarshal(data, &snapshot) == nil && snapshot.Friendships != nil {
			s.byID = snapshot.Friendships
		}
	}
	return s
}

func (s *FriendStore) persistLocked() error {
	data, err := json.Marshal(friendStoreSnapshot{Friendships: s.byID})
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *FriendStore) newIDLocked() (string, error) {
	buf := make([]byte, 16)
	if _, err := s.randRead(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func friendshipPairKey(a, b string) (string, string) {
	ca, cb := compactAddress(a), compactAddress(b)
	if ca < cb {
		return ca, cb
	}
	return cb, ca
}

func (s *FriendStore) findPairLocked(a, b string) (Friendship, bool) {
	lo, hi := friendshipPairKey(a, b)
	for _, f := range s.byID {
		flo, fhi := friendshipPairKey(f.RequesterAddress, f.RecipientAddress)
		if flo == lo && fhi == hi {
			return f, true
		}
	}
	return Friendship{}, false
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

	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now().Unix()
	if existing, ok := s.findPairLocked(from, to); ok {
		switch existing.Status {
		case FriendshipPending, FriendshipAccepted:
			return Friendship{}, errConflict
		case FriendshipDeclined:
			existing.RequesterAddress = from
			existing.RecipientAddress = to
			existing.Status = FriendshipPending
			existing.UpdatedAt = now
			s.byID[existing.ID] = existing
			if err := s.persistLocked(); err != nil {
				return Friendship{}, err
			}
			return existing, nil
		}
	}

	id, err := s.newIDLocked()
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
	s.byID[id] = f
	if err := s.persistLocked(); err != nil {
		delete(s.byID, id)
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
	s.mu.Lock()
	defer s.mu.Unlock()

	f, ok := s.byID[id]
	if !ok || f.Status != FriendshipPending {
		return Friendship{}, errNotFound
	}
	if compactAddress(f.RecipientAddress) != actor {
		return Friendship{}, errUnauthorized
	}
	prev := f
	f.Status = status
	f.UpdatedAt = s.now().Unix()
	s.byID[id] = f
	if err := s.persistLocked(); err != nil {
		s.byID[id] = prev
		return Friendship{}, err
	}
	return f, nil
}

func (s *FriendStore) Remove(actor, other string) error {
	actor = compactAddress(actor)
	other = compactAddress(other)

	s.mu.Lock()
	defer s.mu.Unlock()

	f, ok := s.findPairLocked(actor, other)
	if !ok || f.Status != FriendshipAccepted {
		return errNotFound
	}
	if compactAddress(f.RequesterAddress) != actor && compactAddress(f.RecipientAddress) != actor {
		return errUnauthorized
	}
	delete(s.byID, f.ID)
	if err := s.persistLocked(); err != nil {
		s.byID[f.ID] = f
		return err
	}
	return nil
}

func (s *FriendStore) ListFriends(actor string) ([]Friendship, error) {
	return s.listByStatus(actor, FriendshipAccepted)
}

func (s *FriendStore) ListRequests(actor string) ([]Friendship, error) {
	return s.listByStatus(actor, FriendshipPending)
}

func (s *FriendStore) listByStatus(actor string, status FriendshipStatus) ([]Friendship, error) {
	actor = compactAddress(actor)
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([]Friendship, 0)
	for _, f := range s.byID {
		if f.Status != status {
			continue
		}
		if compactAddress(f.RequesterAddress) == actor || compactAddress(f.RecipientAddress) == actor {
			out = append(out, f)
		}
	}
	return out, nil
}
