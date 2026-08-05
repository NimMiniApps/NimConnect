package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"time"
)

const (
	authChallengeTTL = 5 * time.Minute
	authSessionTTL   = 7 * 24 * time.Hour
)

var (
	errAuthScopeNotAllowed      = errors.New("authorization scope not allowed")
	errAuthChallengeUnavailable = errors.New("authorization challenge unavailable")
	errAuthSessionUnavailable   = errors.New("authorization session unavailable")
)

type AuthGrant struct {
	ID        string
	Address   string
	Audience  string
	Scopes    []string
	CreatedAt time.Time
	ExpiresAt time.Time
}

type AuthChallenge struct {
	AuthGrant
	Nonce   string
	Message string
}

type AuthStore struct {
	db       *sql.DB
	now      func() time.Time
	randRead func([]byte) (int, error)
}

func NewAuthStore(db *sql.DB) *AuthStore {
	return &AuthStore{
		db:       db,
		now:      time.Now,
		randRead: rand.Read,
	}
}

func (s *AuthStore) randomString(byteCount int) (string, error) {
	buf := make([]byte, byteCount)
	n, err := s.randRead(buf)
	if err != nil {
		return "", err
	}
	if n != len(buf) {
		return "", io.ErrUnexpectedEOF
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func canonicalScopes(scopes []string) []string {
	unique := make(map[string]struct{}, len(scopes))
	for _, scope := range scopes {
		unique[scope] = struct{}{}
	}
	result := make([]string, 0, len(unique))
	for scope := range unique {
		result = append(result, scope)
	}
	sort.Strings(result)
	return result
}

func (s *AuthStore) ValidateScopes(audience string, requested []string) ([]string, error) {
	canonical := canonicalScopes(requested)
	if len(canonical) == 0 {
		return nil, errAuthScopeNotAllowed
	}

	rows, err := s.db.Query(`
		SELECT auth_app_scopes.scope
		FROM auth_app_scopes
		JOIN auth_apps USING (audience)
		WHERE auth_app_scopes.audience = $1 AND auth_apps.enabled = true`, audience)
	if err != nil {
		return nil, fmt.Errorf("load app scopes: %w", err)
	}
	defer rows.Close()

	allowed := make(map[string]struct{})
	for rows.Next() {
		var scope string
		if err := rows.Scan(&scope); err != nil {
			return nil, fmt.Errorf("scan app scope: %w", err)
		}
		allowed[scope] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate app scopes: %w", err)
	}
	for _, scope := range canonical {
		if _, ok := allowed[scope]; !ok {
			return nil, errAuthScopeNotAllowed
		}
	}
	return canonical, nil
}

func (s *AuthStore) OriginAllowed(audience, origin string) (bool, error) {
	if origin == "" {
		return true, nil
	}
	var allowed bool
	err := s.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM auth_app_origins
			JOIN auth_apps USING (audience)
			WHERE audience = $1 AND origin = $2 AND auth_apps.enabled = true
		)`, audience, origin).Scan(&allowed)
	if err != nil {
		return false, fmt.Errorf("check authorization origin: %w", err)
	}
	return allowed, nil
}

// OriginRegistered reports whether any enabled app owns the origin. CORS uses
// this to admit registered first-party apps without duplicating their origins
// in deployment configuration.
func (s *AuthStore) OriginRegistered(origin string) (bool, error) {
	if origin == "" {
		return false, nil
	}
	var allowed bool
	err := s.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM auth_app_origins
			JOIN auth_apps USING (audience)
			WHERE origin = $1 AND auth_apps.enabled = true
		)`, origin).Scan(&allowed)
	if err != nil {
		return false, fmt.Errorf("check registered authorization origin: %w", err)
	}
	return allowed, nil
}

func (s *AuthStore) CreateChallenge(
	address string,
	audience string,
	scopes []string,
	buildMessage func(nonce string, expiresAt time.Time) string,
) (AuthChallenge, error) {
	canonical, err := s.ValidateScopes(audience, scopes)
	if err != nil {
		return AuthChallenge{}, err
	}
	if buildMessage == nil {
		return AuthChallenge{}, errors.New("authorization message builder is required")
	}

	id, err := s.randomString(16)
	if err != nil {
		return AuthChallenge{}, fmt.Errorf("generate challenge id: %w", err)
	}
	nonce, err := s.randomString(32)
	if err != nil {
		return AuthChallenge{}, fmt.Errorf("generate challenge nonce: %w", err)
	}
	now := s.now().UTC()
	expiresAt := now.Add(authChallengeTTL)
	message := buildMessage(nonce, expiresAt)
	nonceHash := sha256.Sum256([]byte(nonce))
	address = compactAddress(address)

	_, err = s.db.Exec(`
		INSERT INTO auth_challenges
			(id, nonce_hash, address, audience, scopes, message, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		id, nonceHash[:], address, audience, canonical, message, now, expiresAt)
	if err != nil {
		return AuthChallenge{}, fmt.Errorf("insert authorization challenge: %w", err)
	}

	return AuthChallenge{
		AuthGrant: AuthGrant{
			ID: id, Address: address, Audience: audience, Scopes: canonical,
			CreatedAt: now, ExpiresAt: expiresAt,
		},
		Nonce: nonce, Message: message,
	}, nil
}

func (s *AuthStore) ConsumeChallenge(id string) (AuthChallenge, error) {
	row := s.db.QueryRow(`
		UPDATE auth_challenges
		SET consumed_at = now()
		WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
		RETURNING address, audience, array_to_json(scopes)::text, message, created_at, expires_at`, id)
	challenge := AuthChallenge{AuthGrant: AuthGrant{ID: id}}
	var scopesJSON string
	if err := row.Scan(
		&challenge.Address,
		&challenge.Audience,
		&scopesJSON,
		&challenge.Message,
		&challenge.CreatedAt,
		&challenge.ExpiresAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthChallenge{}, errAuthChallengeUnavailable
		}
		return AuthChallenge{}, fmt.Errorf("consume authorization challenge: %w", err)
	}
	if err := json.Unmarshal([]byte(scopesJSON), &challenge.Scopes); err != nil {
		return AuthChallenge{}, fmt.Errorf("decode authorization challenge scopes: %w", err)
	}
	challenge.CreatedAt = challenge.CreatedAt.UTC()
	challenge.ExpiresAt = challenge.ExpiresAt.UTC()
	return challenge, nil
}

func (s *AuthStore) GetChallenge(id string) (AuthChallenge, error) {
	row := s.db.QueryRow(`
		SELECT address, audience, array_to_json(scopes)::text, message, created_at, expires_at
		FROM auth_challenges
		WHERE id = $1 AND consumed_at IS NULL AND expires_at > $2`, id, s.now().UTC())
	challenge := AuthChallenge{AuthGrant: AuthGrant{ID: id}}
	var scopesJSON string
	if err := row.Scan(&challenge.Address, &challenge.Audience, &scopesJSON, &challenge.Message, &challenge.CreatedAt, &challenge.ExpiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthChallenge{}, errAuthChallengeUnavailable
		}
		return AuthChallenge{}, fmt.Errorf("get authorization challenge: %w", err)
	}
	if err := json.Unmarshal([]byte(scopesJSON), &challenge.Scopes); err != nil {
		return AuthChallenge{}, fmt.Errorf("decode authorization challenge scopes: %w", err)
	}
	challenge.CreatedAt = challenge.CreatedAt.UTC()
	challenge.ExpiresAt = challenge.ExpiresAt.UTC()
	return challenge, nil
}

func (s *AuthStore) IssueSession(address, audience string, scopes []string) (string, AuthGrant, error) {
	canonical, err := s.ValidateScopes(audience, scopes)
	if err != nil {
		return "", AuthGrant{}, err
	}
	token, err := s.randomString(32)
	if err != nil {
		return "", AuthGrant{}, fmt.Errorf("generate bearer token: %w", err)
	}
	tokenHash := sha256.Sum256([]byte(token))
	now := s.now().UTC()
	expiresAt := now.Add(authSessionTTL)
	address = compactAddress(address)
	grant := AuthGrant{
		ID:        hex.EncodeToString(tokenHash[:]),
		Address:   address,
		Audience:  audience,
		Scopes:    canonical,
		CreatedAt: now,
		ExpiresAt: expiresAt,
	}

	_, err = s.db.Exec(`
		INSERT INTO auth_sessions
			(token_hash, address, audience, scopes, created_at, expires_at, last_used_at)
		VALUES ($1, $2, $3, $4, $5, $6, $5)`,
		tokenHash[:], address, audience, canonical, now, expiresAt)
	if err != nil {
		return "", AuthGrant{}, fmt.Errorf("insert authorization session: %w", err)
	}
	return token, grant, nil
}

func tokenDigest(token string) [sha256.Size]byte {
	return sha256.Sum256([]byte(token))
}

func (s *AuthStore) ResolveSession(token string) (AuthGrant, error) {
	if token == "" {
		return AuthGrant{}, errAuthSessionUnavailable
	}
	digest := tokenDigest(token)
	row := s.db.QueryRow(`
		SELECT encode(auth_sessions.token_hash, 'hex'), auth_sessions.address,
		       auth_sessions.audience, array_to_json(auth_sessions.scopes)::text,
		       auth_sessions.created_at, auth_sessions.expires_at
		FROM auth_sessions
		JOIN auth_apps USING (audience)
		WHERE auth_sessions.token_hash = $1
		  AND auth_sessions.revoked_at IS NULL
		  AND auth_sessions.expires_at > $2
		  AND auth_apps.enabled = true`, digest[:], s.now().UTC())
	var grant AuthGrant
	var scopesJSON string
	if err := row.Scan(&grant.ID, &grant.Address, &grant.Audience, &scopesJSON, &grant.CreatedAt, &grant.ExpiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthGrant{}, errAuthSessionUnavailable
		}
		return AuthGrant{}, fmt.Errorf("resolve authorization session: %w", err)
	}
	if err := json.Unmarshal([]byte(scopesJSON), &grant.Scopes); err != nil {
		return AuthGrant{}, fmt.Errorf("decode authorization session scopes: %w", err)
	}
	grant.CreatedAt = grant.CreatedAt.UTC()
	grant.ExpiresAt = grant.ExpiresAt.UTC()
	return grant, nil
}

func (s *AuthStore) TouchSession(token string) error {
	if token == "" {
		return errAuthSessionUnavailable
	}
	digest := tokenDigest(token)
	now := s.now().UTC()
	result, err := s.db.Exec(`
		UPDATE auth_sessions
		SET last_used_at = $2
		WHERE token_hash = $1
		  AND revoked_at IS NULL
		  AND expires_at > $2
		  AND EXISTS (
			SELECT 1 FROM auth_apps
			WHERE auth_apps.audience = auth_sessions.audience AND auth_apps.enabled = true
		  )`, digest[:], now)
	if err != nil {
		return fmt.Errorf("touch authorization session: %w", err)
	}
	return requireAffectedSession(result)
}

func (s *AuthStore) RevokeSession(token string) error {
	if token == "" {
		return errAuthSessionUnavailable
	}
	digest := tokenDigest(token)
	result, err := s.db.Exec(`
		UPDATE auth_sessions
		SET revoked_at = $2
		WHERE token_hash = $1 AND revoked_at IS NULL`, digest[:], s.now().UTC())
	if err != nil {
		return fmt.Errorf("revoke authorization session: %w", err)
	}
	return requireAffectedSession(result)
}

func requireAffectedSession(result sql.Result) error {
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return errAuthSessionUnavailable
	}
	return nil
}

func (s *AuthStore) RevokeAllSessions(address string) (int64, error) {
	result, err := s.db.Exec(`
		UPDATE auth_sessions
		SET revoked_at = $2
		WHERE address = $1 AND revoked_at IS NULL`, compactAddress(address), s.now().UTC())
	if err != nil {
		return 0, fmt.Errorf("revoke wallet authorization sessions: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("count revoked authorization sessions: %w", err)
	}
	return count, nil
}
