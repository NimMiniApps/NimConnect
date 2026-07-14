package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"sync"
)

const profileMaxPayloadBytes = 2048

// Per-field caps mirror the SharedProfile limits in src/services/profile-share.ts.
var profileStringCaps = map[string]int{
	"display_name": 64,
	"bio":          300,
	"website":      200,
	"github":       39,
	"x":            15,
}

const (
	profileMaxTags   = 8
	profileTagMaxLen = 24
)

func profilePutMessage(address string, updatedAt int64, payloadHash string) string {
	return "nimconnect:profile:v1" +
		"\naddress=" + compactAddress(address) +
		"\nupdatedAt=" + strconv.FormatInt(updatedAt, 10) +
		"\npayloadHash=" + payloadHash
}

func profileDeleteMessage(address string, updatedAt int64) string {
	return "nimconnect:profile-delete:v1" +
		"\naddress=" + compactAddress(address) +
		"\nupdatedAt=" + strconv.FormatInt(updatedAt, 10)
}

// validateProfilePayload enforces the public-profile schema: a flat JSON
// object, whitelisted keys, capped strings, ≤8 short string tags.
// Unknown keys are rejected now; loosening later is non-breaking.
func validateProfilePayload(raw string) error {
	if len(raw) == 0 || len(raw) > profileMaxPayloadBytes {
		return errBadRequest
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(raw), &obj); err != nil || obj == nil {
		return errBadRequest
	}
	for key, value := range obj {
		if cap, ok := profileStringCaps[key]; ok {
			s, isString := value.(string)
			if !isString || len(s) > cap {
				return errBadRequest
			}
			continue
		}
		if key == "tags" {
			tags, isArray := value.([]any)
			if !isArray || len(tags) > profileMaxTags {
				return errBadRequest
			}
			for _, tag := range tags {
				s, isString := tag.(string)
				if !isString || s == "" || len(s) > profileTagMaxLen {
					return errBadRequest
				}
			}
			continue
		}
		return errBadRequest // unknown key
	}
	return nil
}

type ProfilePutRequest struct {
	Address   string `json:"address"`
	UpdatedAt int64  `json:"updated_at"`
	Profile   string `json:"profile"`
	PublicKey string `json:"public_key"`
	Signature string `json:"signature"`
}

type StoredProfile struct {
	Address   string `json:"address"`
	UpdatedAt int64  `json:"updated_at"`
	Profile   string `json:"profile"`
	PublicKey string `json:"public_key"`
	Signature string `json:"signature"`
}

// ProfileStore holds one signed profile JSON file per address.
// ponytail: one global mutex; per-address locks if write volume ever matters.
type ProfileStore struct {
	dir string
	mu  sync.Mutex
}

func NewProfileStore(dir string) *ProfileStore {
	return &ProfileStore{dir: dir}
}

func (s *ProfileStore) path(compact string) string {
	return filepath.Join(s.dir, compact+".json")
}

// read returns the stored profile, errNotFound when absent. Callers hold s.mu.
func (s *ProfileStore) read(compact string) (StoredProfile, error) {
	var p StoredProfile
	data, err := readFileIfExists(s.path(compact))
	if err != nil {
		return p, err
	}
	if data == nil {
		return p, errNotFound
	}
	if err := json.Unmarshal(data, &p); err != nil {
		return p, err
	}
	return p, nil
}

func (s *ProfileStore) Put(req ProfilePutRequest) error {
	if !isValidNimiqAddress(req.Address) || req.UpdatedAt <= 0 {
		return errBadRequest
	}
	if err := validateProfilePayload(req.Profile); err != nil {
		return err
	}
	message := profilePutMessage(req.Address, req.UpdatedAt, sha256Hex(req.Profile))
	if err := verifySignedMessage(req.Address, req.PublicKey, req.Signature, message); err != nil {
		return errUnauthorized
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	existing, err := s.read(compactAddress(req.Address))
	if err != nil && !errors.Is(err, errNotFound) {
		return err
	}
	if err == nil && req.UpdatedAt <= existing.UpdatedAt {
		return errConflict // replay or stale update
	}

	stored := StoredProfile{
		Address:   normalizeAddress(req.Address),
		UpdatedAt: req.UpdatedAt,
		Profile:   req.Profile,
		PublicKey: req.PublicKey,
		Signature: req.Signature,
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	path := s.path(compactAddress(req.Address))
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *ProfileStore) Get(address string) (StoredProfile, error) {
	if !isValidNimiqAddress(address) {
		return StoredProfile{}, errBadRequest
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read(compactAddress(address))
}

func (s *ProfileStore) Delete(address string, updatedAt int64, publicKey, signature string) error {
	if !isValidNimiqAddress(address) || updatedAt <= 0 {
		return errBadRequest
	}
	if err := verifySignedMessage(address, publicKey, signature, profileDeleteMessage(address, updatedAt)); err != nil {
		return errUnauthorized
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	existing, err := s.read(compactAddress(address))
	if err != nil {
		return err
	}
	if updatedAt <= existing.UpdatedAt {
		return errConflict
	}
	return os.Remove(s.path(compactAddress(address)))
}
