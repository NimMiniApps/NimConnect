package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"sort"
)

var errAppNotFound = errors.New("app not found")

// AppRecord is NimConnect's mirror of a catalog app: identity, verification,
// declared scopes and allowed launch origins. NimConnect owns wallets,
// grants and tokens; the catalog owns everything here (see
// docs/plans/2026-08-07-ecosystem-awards-and-app-registry-design.md).
type AppRecord struct {
	Audience    string
	DisplayName string
	IconURL     string
	Verified    bool
	OwnerID     string
	Enabled     bool
	Scopes      []string
	Origins     []string
}

func (s *AuthStore) GetApp(audience string) (AppRecord, error) {
	rec := AppRecord{Audience: audience}
	err := s.db.QueryRow(`
		SELECT display_name, icon_url, verified, owner_id, enabled
		FROM auth_apps WHERE audience = $1`, audience).
		Scan(&rec.DisplayName, &rec.IconURL, &rec.Verified, &rec.OwnerID, &rec.Enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return AppRecord{}, errAppNotFound
	}
	if err != nil {
		return AppRecord{}, fmt.Errorf("get app: %w", err)
	}
	if rec.Scopes, err = s.appScopes(audience); err != nil {
		return AppRecord{}, err
	}
	if rec.Origins, err = s.appOrigins(audience); err != nil {
		return AppRecord{}, err
	}
	return rec, nil
}

func (s *AuthStore) appScopes(audience string) ([]string, error) {
	rows, err := s.db.Query(`SELECT scope FROM auth_app_scopes WHERE audience = $1 ORDER BY scope`, audience)
	if err != nil {
		return nil, fmt.Errorf("load app scopes: %w", err)
	}
	defer rows.Close()
	var scopes []string
	for rows.Next() {
		var scope string
		if err := rows.Scan(&scope); err != nil {
			return nil, fmt.Errorf("scan app scope: %w", err)
		}
		scopes = append(scopes, scope)
	}
	return scopes, rows.Err()
}

func (s *AuthStore) appOrigins(audience string) ([]string, error) {
	rows, err := s.db.Query(`SELECT origin FROM auth_app_origins WHERE audience = $1 ORDER BY origin`, audience)
	if err != nil {
		return nil, fmt.Errorf("load app origins: %w", err)
	}
	defer rows.Close()
	var origins []string
	for rows.Next() {
		var origin string
		if err := rows.Scan(&origin); err != nil {
			return nil, fmt.Errorf("scan app origin: %w", err)
		}
		origins = append(origins, origin)
	}
	return origins, rows.Err()
}

// UpsertApp mirrors an app record from the catalog. If the app already
// existed with a different owner or declared scope set, every outstanding
// session for it is revoked — an app that changed hands or gained scopes
// never inherits consent a wallet gave to the app as it was before.
func (s *AuthStore) UpsertApp(rec AppRecord) error {
	if !authorizationAudienceRe.MatchString(rec.Audience) {
		return errors.New("invalid app audience")
	}
	scopes := canonicalScopes(rec.Scopes)
	for _, scope := range scopes {
		if _, ok := authorizationScopes[scope]; !ok {
			return fmt.Errorf("unknown authorization scope %q", scope)
		}
	}
	origins := uniqueSorted(rec.Origins)

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin app upsert: %w", err)
	}
	defer tx.Rollback()

	var priorOwner string
	var priorScopes []string
	err = tx.QueryRow(`SELECT owner_id FROM auth_apps WHERE audience = $1`, rec.Audience).Scan(&priorOwner)
	existed := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("load prior app: %w", err)
	}
	if existed {
		rows, err := tx.Query(`SELECT scope FROM auth_app_scopes WHERE audience = $1 ORDER BY scope`, rec.Audience)
		if err != nil {
			return fmt.Errorf("load prior app scopes: %w", err)
		}
		for rows.Next() {
			var scope string
			if err := rows.Scan(&scope); err != nil {
				rows.Close()
				return fmt.Errorf("scan prior app scope: %w", err)
			}
			priorScopes = append(priorScopes, scope)
		}
		rows.Close()
	}

	_, err = tx.Exec(`
		INSERT INTO auth_apps (audience, display_name, icon_url, verified, owner_id, enabled)
		VALUES ($1, $2, $3, $4, $5, true)
		ON CONFLICT (audience) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			icon_url = EXCLUDED.icon_url,
			verified = EXCLUDED.verified,
			owner_id = EXCLUDED.owner_id`,
		rec.Audience, rec.DisplayName, rec.IconURL, rec.Verified, rec.OwnerID)
	if err != nil {
		return fmt.Errorf("upsert app: %w", err)
	}

	if _, err := tx.Exec(`DELETE FROM auth_app_scopes WHERE audience = $1`, rec.Audience); err != nil {
		return fmt.Errorf("clear app scopes: %w", err)
	}
	for _, scope := range scopes {
		if _, err := tx.Exec(`INSERT INTO auth_app_scopes (audience, scope) VALUES ($1, $2)`, rec.Audience, scope); err != nil {
			return fmt.Errorf("insert app scope: %w", err)
		}
	}

	if _, err := tx.Exec(`DELETE FROM auth_app_origins WHERE audience = $1`, rec.Audience); err != nil {
		return fmt.Errorf("clear app origins: %w", err)
	}
	for _, origin := range origins {
		if _, err := tx.Exec(`INSERT INTO auth_app_origins (audience, origin) VALUES ($1, $2)`, rec.Audience, origin); err != nil {
			return fmt.Errorf("insert app origin: %w", err)
		}
	}

	scopesChanged := existed && !equalStrings(priorScopes, scopes)
	ownerChanged := existed && priorOwner != rec.OwnerID
	if scopesChanged || ownerChanged {
		if _, err := tx.Exec(`
			UPDATE auth_sessions SET revoked_at = now()
			WHERE audience = $1 AND revoked_at IS NULL`, rec.Audience); err != nil {
			return fmt.Errorf("revoke sessions on app change: %w", err)
		}
	}

	return tx.Commit()
}

func uniqueSorted(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, v := range values {
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// IssueAppAPIKey generates a new credential for app-authenticated endpoints
// (currently just POST /api/awards) and stores only its hash, mirroring how
// bearer session tokens are handled. The plaintext key is returned once.
func (s *AuthStore) IssueAppAPIKey(audience string) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate app api key: %w", err)
	}
	key := base64.RawURLEncoding.EncodeToString(buf)
	digest := sha256.Sum256([]byte(key))
	result, err := s.db.Exec(`UPDATE auth_apps SET api_key_hash = $2 WHERE audience = $1`, audience, digest[:])
	if err != nil {
		return "", fmt.Errorf("store app api key: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return "", err
	}
	if count != 1 {
		return "", errAppNotFound
	}
	return key, nil
}

// ResolveAppByAPIKey authenticates an app-credential bearer token, returning
// the audience it belongs to.
func (s *AuthStore) ResolveAppByAPIKey(key string) (string, error) {
	if key == "" {
		return "", errAppNotFound
	}
	digest := sha256.Sum256([]byte(key))
	var audience string
	err := s.db.QueryRow(`
		SELECT audience FROM auth_apps
		WHERE api_key_hash = $1 AND enabled = true`, digest[:]).Scan(&audience)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errAppNotFound
	}
	if err != nil {
		return "", fmt.Errorf("resolve app api key: %w", err)
	}
	return audience, nil
}
