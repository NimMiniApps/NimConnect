package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const (
	// Caps before signature work / persistence (SEC-001). Body also limited in the handler.
	backupMaxSaltDecoded       = 64
	backupMaxCiphertextDecoded = 200 * 1024
	backupMaxSaltB64           = 128
	backupMaxCiphertextB64     = 280 * 1024
)

type BackupRecord struct {
	Address       string          `json:"address"`
	ExportedAt    int64           `json:"exported_at"`
	Salt          string          `json:"salt"`
	Ciphertext    string          `json:"ciphertext"`
	PublicKey     string          `json:"public_key"`
	Signature     string          `json:"signature"`
	FormatVersion int             `json:"format_version,omitempty"`
	Kdf           json.RawMessage `json:"kdf,omitempty"`
}

type BackupPutRequest struct {
	ExportedAt    int64           `json:"exported_at"`
	Salt          string          `json:"salt"`
	Ciphertext    string          `json:"ciphertext"`
	PublicKey     string          `json:"public_key"`
	Signature     string          `json:"signature"`
	FormatVersion int             `json:"format_version,omitempty"`
	Kdf           json.RawMessage `json:"kdf,omitempty"`
}

type BackupStore struct {
	dir string
}

func NewBackupStore(dir string) *BackupStore {
	return &BackupStore{dir: dir}
}

func (s *BackupStore) pathFor(address string) string {
	name := compactAddress(address) + ".json"
	return filepath.Join(s.dir, name)
}

func (s *BackupStore) Get(address string) (BackupRecord, error) {
	data, err := os.ReadFile(s.pathFor(address))
	if errors.Is(err, os.ErrNotExist) {
		return BackupRecord{}, errNotFound
	}
	if err != nil {
		return BackupRecord{}, err
	}
	var rec BackupRecord
	if err := json.Unmarshal(data, &rec); err != nil {
		return BackupRecord{}, err
	}
	return rec, nil
}

func decodeBackupField(b64 string, maxDecoded int) ([]byte, error) {
	b64 = strings.TrimSpace(b64)
	if b64 == "" {
		return nil, errBadRequest
	}
	decoded, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, errBadRequest
	}
	if len(decoded) == 0 || len(decoded) > maxDecoded {
		return nil, errBadRequest
	}
	return decoded, nil
}

func ciphertextSHA256Hex(ciphertextB64 string) (string, error) {
	raw, err := decodeBackupField(ciphertextB64, backupMaxCiphertextDecoded)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func (s *BackupStore) Put(address string, req BackupPutRequest) error {
	req.Salt = strings.TrimSpace(req.Salt)
	req.Ciphertext = strings.TrimSpace(req.Ciphertext)
	req.PublicKey = strings.TrimSpace(req.PublicKey)
	req.Signature = strings.TrimSpace(req.Signature)

	if req.ExportedAt <= 0 || req.Salt == "" || req.Ciphertext == "" || req.PublicKey == "" || req.Signature == "" {
		return errBadRequest
	}
	if len(req.Salt) > backupMaxSaltB64 || len(req.Ciphertext) > backupMaxCiphertextB64 {
		return errBadRequest
	}
	if _, err := decodeBackupField(req.Salt, backupMaxSaltDecoded); err != nil {
		return err
	}
	ciphertextHash, err := ciphertextSHA256Hex(req.Ciphertext)
	if err != nil {
		return err
	}

	// Only v2 envelopes may write. A harvested v1 signature must not authorize
	// salt/ciphertext replacement (SEC-001).
	if err := verifyBackupAuthV2(address, req.PublicKey, req.Signature, req.ExportedAt, req.Salt, ciphertextHash); err != nil {
		return errUnauthorized
	}

	existing, err := s.Get(address)
	if err != nil && !errors.Is(err, errNotFound) {
		return err
	}
	if err == nil {
		identical := existing.ExportedAt == req.ExportedAt &&
			existing.Salt == req.Salt &&
			existing.Ciphertext == req.Ciphertext &&
			existing.PublicKey == req.PublicKey &&
			existing.Signature == req.Signature &&
			existing.FormatVersion == req.FormatVersion &&
			string(existing.Kdf) == string(req.Kdf)
		if identical {
			return nil
		}
		if req.ExportedAt <= existing.ExportedAt {
			return errConflict
		}
	}

	rec := BackupRecord{
		Address:       normalizeAddress(address),
		ExportedAt:    req.ExportedAt,
		Salt:          req.Salt,
		Ciphertext:    req.Ciphertext,
		PublicKey:     req.PublicKey,
		Signature:     req.Signature,
		FormatVersion: req.FormatVersion,
		Kdf:           req.Kdf,
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	tmp := s.pathFor(address) + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.pathFor(address))
}

var (
	errNotFound     = errors.New("not found")
	errBadRequest   = errors.New("bad request")
	errUnauthorized = errors.New("unauthorized")
	errConflict     = errors.New("conflict")
)
