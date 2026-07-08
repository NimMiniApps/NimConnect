package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type BackupRecord struct {
	Address    string `json:"address"`
	ExportedAt int64  `json:"exported_at"`
	Salt       string `json:"salt"`
	Ciphertext string `json:"ciphertext"`
	PublicKey  string `json:"public_key"`
	Signature  string `json:"signature"`
}

type BackupPutRequest struct {
	ExportedAt int64  `json:"exported_at"`
	Salt       string `json:"salt"`
	Ciphertext string `json:"ciphertext"`
	PublicKey  string `json:"public_key"`
	Signature  string `json:"signature"`
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

func (s *BackupStore) Put(address string, req BackupPutRequest) error {
	if req.ExportedAt <= 0 || req.Salt == "" || req.Ciphertext == "" || req.PublicKey == "" || req.Signature == "" {
		return errBadRequest
	}
	if err := verifyBackupAuth(address, req.PublicKey, req.Signature, req.ExportedAt); err != nil {
		return errUnauthorized
	}

	existing, err := s.Get(address)
	if err == nil && req.ExportedAt < existing.ExportedAt {
		return errConflict
	}
	if err != nil && !errors.Is(err, errNotFound) {
		return err
	}

	rec := BackupRecord{
		Address:    normalizeAddress(address),
		ExportedAt: req.ExportedAt,
		Salt:       req.Salt,
		Ciphertext: req.Ciphertext,
		PublicKey:  strings.TrimSpace(req.PublicKey),
		Signature:  strings.TrimSpace(req.Signature),
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
