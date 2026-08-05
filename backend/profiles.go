package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
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
			// website is rendered as a link on public pages — http(s) only,
			// so javascript:/data: URIs can never reach an href.
			if key == "website" && !isSafeHTTPURL(s) {
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

func isSafeHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

type ProfilePutRequest struct {
	Address   string `json:"address"`
	UpdatedAt int64  `json:"updated_at"`
	Profile   string `json:"profile"`
	PublicKey string `json:"public_key"`
	Signature string `json:"signature"`
}

type StoredProfile struct {
	Address       string `json:"address"`
	UpdatedAt     int64  `json:"updated_at"`
	Profile       string `json:"profile"`
	PublicKey     string `json:"public_key"`
	Signature     string `json:"signature"`
	AuthMode      string `json:"auth_mode,omitempty"`
	AuthSessionID string `json:"-"`
	AuthAudience  string `json:"auth_audience,omitempty"`
}

// ProfileStore holds one signed profile row per address in Postgres.
type ProfileStore struct {
	db *sql.DB
	mu sync.Mutex
}

func NewProfileStore(db *sql.DB) *ProfileStore {
	return &ProfileStore{db: db}
}

// read returns the stored profile, errNotFound when absent. Callers hold s.mu.
func (s *ProfileStore) read(compact string) (StoredProfile, error) {
	var p StoredProfile
	var payload string
	err := s.db.QueryRow(`
		SELECT address, payload, updated_at, COALESCE(public_key,''), COALESCE(signature,''), auth_mode, COALESCE(auth_session_id,''), COALESCE(auth_audience,'')
		FROM profiles WHERE address = $1`, compact).Scan(
		&p.Address, &payload, &p.UpdatedAt, &p.PublicKey, &p.Signature, &p.AuthMode, &p.AuthSessionID, &p.AuthAudience,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return StoredProfile{}, errNotFound
	}
	if err != nil {
		return StoredProfile{}, err
	}
	p.Address = normalizeAddress(p.Address)
	p.Profile = payload
	return p, nil
}

func (s *ProfileStore) Put(req ProfilePutRequest) error {
	return s.put(req, true, AuthGrant{})
}

func (s *ProfileStore) PutAuthorized(actor string, req ProfilePutRequest, grant AuthGrant) error {
	req.Address = actor
	return s.put(req, false, grant)
}

func (s *ProfileStore) put(req ProfilePutRequest, verifySignature bool, grant AuthGrant) error {
	if !isValidNimiqAddress(req.Address) || req.UpdatedAt <= 0 {
		return errBadRequest
	}
	if err := validateProfilePayload(req.Profile); err != nil {
		return err
	}
	if verifySignature {
		message := profilePutMessage(req.Address, req.UpdatedAt, sha256Hex(req.Profile))
		if err := verifySignedMessage(req.Address, req.PublicKey, req.Signature, message); err != nil {
			return errUnauthorized
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	compact := compactAddress(req.Address)
	existing, err := s.read(compact)
	if err != nil && !errors.Is(err, errNotFound) {
		return err
	}
	if err == nil && req.UpdatedAt <= existing.UpdatedAt {
		return errConflict // replay or stale update
	}

	_, err = s.db.Exec(`
		INSERT INTO profiles (address, payload, updated_at, public_key, signature, auth_mode, auth_session_id, auth_audience)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (address) DO UPDATE SET
			payload = EXCLUDED.payload,
			updated_at = EXCLUDED.updated_at,
			public_key = EXCLUDED.public_key,
			signature = EXCLUDED.signature,
			auth_mode = EXCLUDED.auth_mode,
			auth_session_id = EXCLUDED.auth_session_id,
			auth_audience = EXCLUDED.auth_audience`,
		compact, req.Profile, req.UpdatedAt, req.PublicKey, req.Signature,
		map[bool]string{true: "wallet_signature", false: "scoped_session"}[verifySignature], grant.ID, grant.Audience,
	)
	return err
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
	if err := verifySignedMessage(address, publicKey, signature, profileDeleteMessage(address, updatedAt)); err != nil {
		return errUnauthorized
	}
	return s.delete(address, updatedAt)
}

func (s *ProfileStore) DeleteAuthorized(address string, updatedAt int64) error {
	return s.delete(address, updatedAt)
}

func (s *ProfileStore) delete(address string, updatedAt int64) error {
	if !isValidNimiqAddress(address) || updatedAt <= 0 {
		return errBadRequest
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	compact := compactAddress(address)
	existing, err := s.read(compact)
	if err != nil {
		return err
	}
	if updatedAt <= existing.UpdatedAt {
		return errConflict
	}
	_, err = s.db.Exec(`DELETE FROM profiles WHERE address = $1`, compact)
	return err
}
