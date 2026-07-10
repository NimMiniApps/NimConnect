# Payment-Request Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server-side mailbox so a NimConnect user can send signed payment requests (invoices, splits, reminders) that appear inside the recipient's app.

**Architecture:** The Go backend gains a file-backed `InboxStore` (one dir per recipient, one JSON file per message) guarded by per-mailbox mutexes, with wallet-signature auth reusing the existing backup-auth verification. The Vue client gains an `inbox` service (send via Nimiq Pay signature popup, poll with a cached 14-day read capability), an import pipeline into a new Dexie table, and Activity-page UI. Spec: `docs/superpowers/specs/2026-07-11-payment-request-inbox-design.md`.

**Tech Stack:** Go stdlib (+ existing `golang.org/x/crypto/blake2b`), Vue 3 + Pinia + Dexie, vitest, `@nimiq/utils`, `@nimiq/mini-app-sdk`.

## Global Constraints

- No new dependencies, backend or frontend.
- Backend: file-backed, no DB, no sessions, single instance. All limits: payload ≤ 2048 bytes, 100 messages per mailbox, 10 pending per sender per mailbox, `sent_at` within ±10 minutes of server time, read capability valid 14 days, retention 60 days, directory scan cap 1000 entries.
- Canonical signed messages (exact strings, newline-separated):
  - Send: `nimconnect:inbox:send:v1\nsender={compactSender}\nrecipient={compactRecipient}\nsentAt={sentAt}\nnonce={nonce}\nobjectId={objectId}\npayloadHash={sha256hex(payload)}`
  - Read: `nimconnect:inbox:read:v1\naddress={compactAddress}\nissuedAt={issuedAt}`
- Addresses are always compact-normalized (uppercase, no spaces) before signing, verifying, or building filesystem paths. Never build a path from raw input.
- Client trust rule: a message is only `actionable` if its payload's payment destination equals the signed `sender`.
- Inbox sends always use the sender's **self profile address** as payment destination (not `receiveAddress()`), because Nimiq Pay signs with the key of the self address and the destination==sender invariant must hold for the recipient.
- Run backend tests with `cd backend && go test ./...`; frontend with `npm test`. Commit after every green task.

---

### Task 1: Generalize signature verification (backend)

**Files:**
- Modify: `backend/auth.go`
- Test: `backend/auth_test.go` (existing tests must stay green; add one)

**Interfaces:**
- Produces: `func verifySignedMessage(claimedAddress, publicKeyHex, signatureHex, message string) error` — used by Tasks 3–5.
- `verifyBackupAuth` keeps its exact current signature and behavior.

- [ ] **Step 1: Read `backend/auth_test.go`** to find the existing helper that generates an ed25519 key and signs a Nimiq-prefixed message (it exists — the backup auth tests sign challenges). Reuse it.

- [ ] **Step 2: Write the failing test** in `backend/auth_test.go`:

```go
func TestVerifySignedMessageAcceptsValidAndRejectsTampered(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	addr, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	msg := "nimconnect:inbox:send:v1\nsender=X\nrecipient=Y\nsentAt=1\nnonce=a\nobjectId=b\npayloadHash=c"
	hash := nimiqSignedMessageHash(msg)
	sig := ed25519.Sign(priv, hash[:])

	if err := verifySignedMessage(addr, hex.EncodeToString(pub), hex.EncodeToString(sig), msg); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
	if err := verifySignedMessage(addr, hex.EncodeToString(pub), hex.EncodeToString(sig), msg+"x"); err == nil {
		t.Fatal("tampered message accepted")
	}
	if err := verifySignedMessage("NQ07 0000 0000 0000 0000 0000 0000 0000 0000", hex.EncodeToString(pub), hex.EncodeToString(sig), msg); err == nil {
		t.Fatal("wrong address accepted")
	}
}
```

Adjust the sign helper call to match what `auth_test.go` already provides if one exists.

- [ ] **Step 3: Run to verify failure**: `cd backend && go test ./... -run TestVerifySignedMessage` → FAIL: `undefined: verifySignedMessage`.

- [ ] **Step 4: Implement** in `backend/auth.go` — extract the body of `verifyBackupAuth` into `verifySignedMessage` and delegate:

```go
func verifySignedMessage(claimedAddress string, publicKeyHex string, signatureHex string, message string) error {
	pubBytes, err := decodeHexKeyMaterial(publicKeyHex)
	if err != nil {
		return fmt.Errorf("invalid public key hex")
	}
	sigBytes, err := decodeHexKeyMaterial(signatureHex)
	if err != nil {
		return fmt.Errorf("invalid signature hex")
	}
	if len(pubBytes) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid public key length")
	}
	if len(sigBytes) != ed25519.SignatureSize {
		return fmt.Errorf("invalid signature length")
	}
	derived, err := addressFromPublicKey(pubBytes)
	if err != nil {
		return err
	}
	if compactAddress(derived) != compactAddress(claimedAddress) {
		return fmt.Errorf("public key does not match address")
	}
	hash := nimiqSignedMessageHash(message)
	if !ed25519.Verify(ed25519.PublicKey(pubBytes), hash[:], sigBytes) {
		return fmt.Errorf("invalid signature")
	}
	return nil
}

func verifyBackupAuth(pathAddress string, publicKeyHex string, signatureHex string, exportedAt int64) error {
	return verifySignedMessage(pathAddress, publicKeyHex, signatureHex, backupChallenge(pathAddress, exportedAt))
}
```

- [ ] **Step 5: Run all backend tests**: `cd backend && go test ./...` → PASS (including existing backup auth tests).

- [ ] **Step 6: Commit**: `git add backend/auth.go backend/auth_test.go && git commit -m "refactor: extract verifySignedMessage from backup auth"`

---

### Task 2: Inbox envelope, validation helpers, canonical messages (backend)

**Files:**
- Create: `backend/inbox.go`
- Test: `backend/inbox_test.go`

**Interfaces (produced, used by Tasks 3–5):**
- Types `InboxMessage`, `InboxSendRequest` (JSON tags below are the wire format).
- `func inboxSendMessage(sender, recipient string, sentAt int64, nonce, objectID, payloadHash string) string`
- `func inboxReadMessage(address string, issuedAt int64) string`
- `func isValidNimiqAddress(address string) bool`
- `func isInboxNonce(s string) bool` (32 lowercase hex chars)
- `func isMessageID(s string) bool` (UUID v4 format, lowercase)
- `func newMessageID() string`
- `func sha256Hex(s string) string`
- Constants: `inboxMaxPayloadBytes = 2048`, `inboxMaxMailbox = 100`, `inboxMaxPerSender = 10`, `inboxSendWindow = 10 * time.Minute`, `inboxReadMaxAge = 14 * 24 * time.Hour`, `inboxRetention = 60 * 24 * time.Hour`, `inboxMaxDirEntries = 1000`
- `var errTooMany = errors.New("too many")` (429 mapping; existing `errNotFound`/`errBadRequest`/`errUnauthorized`/`errConflict` are reused)

- [ ] **Step 1: Write failing tests** in `backend/inbox_test.go`:

```go
package main

import (
	"strings"
	"testing"
)

func TestInboxSendMessageCanonicalFormat(t *testing.T) {
	got := inboxSendMessage("NQ11 AAAA", "nq22 bbbb", 42, "abc", "obj-1", "deadbeef")
	want := "nimconnect:inbox:send:v1\nsender=NQ11AAAA\nrecipient=NQ22BBBB\nsentAt=42\nnonce=abc\nobjectId=obj-1\npayloadHash=deadbeef"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestInboxReadMessageCanonicalFormat(t *testing.T) {
	got := inboxReadMessage("nq22 bbbb", 7)
	if got != "nimconnect:inbox:read:v1\naddress=NQ22BBBB\nissuedAt=7" {
		t.Fatalf("got %q", got)
	}
}

func TestIsValidNimiqAddress(t *testing.T) {
	pub := make([]byte, 32)
	valid, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]bool{
		valid:                                  true,
		strings.ToLower(valid):                 true,
		"NQ00 0000 0000 0000 0000 0000 0000 0000 0000": false, // bad checksum
		"../../etc/passwd":                     false,
		"":                                     false,
		valid + "A":                            false,
	}
	for addr, want := range cases {
		if got := isValidNimiqAddress(addr); got != want {
			t.Errorf("isValidNimiqAddress(%q) = %v, want %v", addr, got, want)
		}
	}
}

func TestNonceAndMessageIDFormats(t *testing.T) {
	if !isInboxNonce("0123456789abcdef0123456789abcdef") {
		t.Fatal("valid nonce rejected")
	}
	for _, bad := range []string{"", "xyz", strings.Repeat("A", 32), strings.Repeat("a", 31), strings.Repeat("a", 33)} {
		if isInboxNonce(bad) {
			t.Fatalf("bad nonce accepted: %q", bad)
		}
	}
	id := newMessageID()
	if !isMessageID(id) {
		t.Fatalf("generated id fails own validation: %q", id)
	}
	if isMessageID("../../x") || isMessageID("") {
		t.Fatal("path-traversal id accepted")
	}
}

func TestSha256Hex(t *testing.T) {
	if sha256Hex("abc") != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatal("sha256Hex wrong")
	}
}
```

- [ ] **Step 2: Run to verify failure**: `cd backend && go test ./... -run 'TestInbox|TestIsValid|TestNonce|TestSha256'` → FAIL (undefined symbols).

- [ ] **Step 3: Implement** `backend/inbox.go`:

```go
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	inboxMaxPayloadBytes = 2048
	inboxMaxMailbox      = 100
	inboxMaxPerSender    = 10
	inboxSendWindow      = 10 * time.Minute
	inboxReadMaxAge      = 14 * 24 * time.Hour
	inboxRetention       = 60 * 24 * time.Hour
	inboxMaxDirEntries   = 1000
)

var errTooMany = errors.New("too many")

// InboxMessage is the stored envelope; see the design spec for field semantics.
type InboxMessage struct {
	Version    int    `json:"version"`
	Type       string `json:"type"`
	ID         string `json:"id"`
	ObjectID   string `json:"object_id"`
	Nonce      string `json:"nonce"`
	Sender     string `json:"sender"`
	Recipient  string `json:"recipient"`
	Payload    string `json:"payload"`
	SentAt     int64  `json:"sent_at"`
	ReceivedAt int64  `json:"received_at"`
	PublicKey  string `json:"public_key"`
	Signature  string `json:"signature"`
}

// InboxSendRequest is the POST body: the envelope minus server-assigned fields.
type InboxSendRequest struct {
	Version   int    `json:"version"`
	Type      string `json:"type"`
	ObjectID  string `json:"object_id"`
	Nonce     string `json:"nonce"`
	Sender    string `json:"sender"`
	Recipient string `json:"recipient"`
	Payload   string `json:"payload"`
	SentAt    int64  `json:"sent_at"`
	PublicKey string `json:"public_key"`
	Signature string `json:"signature"`
}

func inboxSendMessage(sender, recipient string, sentAt int64, nonce, objectID, payloadHash string) string {
	return "nimconnect:inbox:send:v1" +
		"\nsender=" + compactAddress(sender) +
		"\nrecipient=" + compactAddress(recipient) +
		"\nsentAt=" + strconv.FormatInt(sentAt, 10) +
		"\nnonce=" + nonce +
		"\nobjectId=" + objectID +
		"\npayloadHash=" + payloadHash
}

func inboxReadMessage(address string, issuedAt int64) string {
	return "nimconnect:inbox:read:v1" +
		"\naddress=" + compactAddress(address) +
		"\nissuedAt=" + strconv.FormatInt(issuedAt, 10)
}

func isValidNimiqAddress(address string) bool {
	c := compactAddress(address)
	if len(c) != 36 || !strings.HasPrefix(c, "NQ") {
		return false
	}
	if _, err := strconv.Atoi(c[2:4]); err != nil {
		return false
	}
	for _, r := range c[4:] {
		if !strings.ContainsRune(nimiqAlphabet, r) {
			return false
		}
	}
	return ibanCheck(c[4:]+c[:4]) == 1
}

var nonceRe = regexp.MustCompile(`^[0-9a-f]{32}$`)
var messageIDRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func isInboxNonce(s string) bool  { return nonceRe.MatchString(s) }
func isMessageID(s string) bool   { return messageIDRe.MatchString(s) }

func newMessageID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
```

- [ ] **Step 4: Run tests**: `cd backend && go test ./...` → PASS.

- [ ] **Step 5: Commit**: `git add backend/inbox.go backend/inbox_test.go && git commit -m "feat(backend): inbox envelope types, canonical messages, validators"`

---

### Task 3: InboxStore Put — validation, replay idempotency, caps (backend)

**Files:**
- Create: `backend/inbox_store.go`
- Test: `backend/inbox_store_test.go`

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces (used by Tasks 4–5):
  - `func NewInboxStore(dir string) *InboxStore` — field `now func() time.Time` overridable in tests.
  - `func (s *InboxStore) Put(req InboxSendRequest) (id string, replay bool, err error)` — errors: `errBadRequest`, `errUnauthorized`, `errConflict` (stale `sent_at`), `errTooMany`.
  - `func (s *InboxStore) readMailbox(compact string) ([]InboxMessage, error)` — internal scan helper (parses files, skips symlinks/corrupt/foreign names, caps at `inboxMaxDirEntries`).
  - `func (s *InboxStore) lock(compact string) *sync.Mutex`

- [ ] **Step 1: Write failing tests** in `backend/inbox_store_test.go`. Test helper first:

```go
package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type inboxTestSender struct {
	pub  ed25519.PublicKey
	priv ed25519.PrivateKey
	addr string
}

func newInboxSender(t *testing.T) inboxTestSender {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	addr, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	return inboxTestSender{pub, priv, addr}
}

func (s inboxTestSender) signedSend(recipient string, sentAt int64, nonce, objectID, payload string) InboxSendRequest {
	msg := inboxSendMessage(s.addr, recipient, sentAt, nonce, objectID, sha256Hex(payload))
	hash := nimiqSignedMessageHash(msg)
	sig := ed25519.Sign(s.priv, hash[:])
	return InboxSendRequest{
		Version: 1, Type: "payment-request",
		ObjectID: objectID, Nonce: nonce,
		Sender: s.addr, Recipient: recipient,
		Payload: payload, SentAt: sentAt,
		PublicKey: hex.EncodeToString(s.pub),
		Signature: hex.EncodeToString(sig),
	}
}

func testStore(t *testing.T, now time.Time) *InboxStore {
	t.Helper()
	store := NewInboxStore(t.TempDir())
	store.now = func() time.Time { return now }
	return store
}

const testNonce = "0123456789abcdef0123456789abcdef"

func TestInboxPutHappyPathAndReplay(t *testing.T) {
	now := time.Now()
	store := testStore(t, now)
	sender := newInboxSender(t)
	recipient := newInboxSender(t)
	req := sender.signedSend(recipient.addr, now.UnixMilli(), testNonce, "inv-1", "nimiq:"+compactAddress(sender.addr)+"?amount=100")

	id, replay, err := store.Put(req)
	if err != nil || replay || !isMessageID(id) {
		t.Fatalf("put: id=%q replay=%v err=%v", id, replay, err)
	}
	id2, replay2, err := store.Put(req) // same sender+nonce
	if err != nil || !replay2 || id2 != id {
		t.Fatalf("replay: id2=%q replay=%v err=%v (want original id %q)", id2, replay2, err, id)
	}
	msgs, err := store.readMailbox(compactAddress(recipient.addr))
	if err != nil || len(msgs) != 1 {
		t.Fatalf("mailbox: %d messages, err=%v", len(msgs), err)
	}
	if msgs[0].ReceivedAt != now.UnixMilli() {
		t.Fatalf("received_at not server time: %d", msgs[0].ReceivedAt)
	}
}

func TestInboxPutRejections(t *testing.T) {
	now := time.Now()
	sender := newInboxSender(t)
	recipient := newInboxSender(t)
	base := func() InboxSendRequest {
		return sender.signedSend(recipient.addr, now.UnixMilli(), testNonce, "inv-1", "nimiq:X?amount=1")
	}

	cases := []struct {
		name    string
		mutate  func(r *InboxSendRequest)
		wantErr error
	}{
		{"payload 2049 bytes", func(r *InboxSendRequest) {
			*r = sender.signedSend(recipient.addr, now.UnixMilli(), testNonce, "inv-1", strings.Repeat("a", 2049))
		}, errBadRequest},
		{"bad version", func(r *InboxSendRequest) { r.Version = 2 }, errBadRequest},
		{"unknown type", func(r *InboxSendRequest) { r.Type = "chat" }, errBadRequest},
		{"bad nonce", func(r *InboxSendRequest) { r.Nonce = "short" }, errBadRequest},
		{"missing object id", func(r *InboxSendRequest) { r.ObjectID = "" }, errBadRequest},
		{"invalid recipient", func(r *InboxSendRequest) { r.Recipient = "../../etc" }, errBadRequest},
		{"tampered payload", func(r *InboxSendRequest) { r.Payload += "x" }, errUnauthorized},
		{"wrong sender claimed", func(r *InboxSendRequest) { r.Sender = recipient.addr }, errUnauthorized},
		{"sent_at too old", func(r *InboxSendRequest) {
			*r = sender.signedSend(recipient.addr, now.Add(-11*time.Minute).UnixMilli(), testNonce, "inv-1", "nimiq:X?amount=1")
		}, errConflict},
		{"sent_at too far future", func(r *InboxSendRequest) {
			*r = sender.signedSend(recipient.addr, now.Add(11*time.Minute).UnixMilli(), testNonce, "inv-1", "nimiq:X?amount=1")
		}, errConflict},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := testStore(t, now)
			req := base()
			tc.mutate(&req)
			if _, _, err := store.Put(req); err == nil || !strings.Contains(err.Error(), tc.wantErr.Error()) && err != tc.wantErr {
				t.Fatalf("want %v, got %v", tc.wantErr, err)
			}
		})
	}
}

func TestInboxPutBoundaries(t *testing.T) {
	now := time.Now()
	store := testStore(t, now)
	sender := newInboxSender(t)
	recipient := newInboxSender(t)

	// payload exactly 2048 bytes is accepted
	ok := sender.signedSend(recipient.addr, now.UnixMilli(), testNonce, "inv-1", strings.Repeat("a", 2048))
	if _, _, err := store.Put(ok); err != nil {
		t.Fatalf("2048-byte payload rejected: %v", err)
	}
	// sent_at exactly at the window edge is accepted
	edge := sender.signedSend(recipient.addr, now.Add(-inboxSendWindow).UnixMilli(), "1123456789abcdef0123456789abcdef", "inv-2", "p")
	if _, _, err := store.Put(edge); err != nil {
		t.Fatalf("edge sent_at rejected: %v", err)
	}
	// sender == recipient is allowed
	self := sender.signedSend(sender.addr, now.UnixMilli(), "2123456789abcdef0123456789abcdef", "inv-3", "p")
	if _, _, err := store.Put(self); err != nil {
		t.Fatalf("self-send rejected: %v", err)
	}
}

func nonceN(i int) string {
	return sha256Hex(strings.Repeat("n", i+1))[:32]
}

func TestInboxPutPerSenderCap(t *testing.T) {
	now := time.Now()
	store := testStore(t, now)
	sender := newInboxSender(t)
	recipient := newInboxSender(t)
	for i := 0; i < inboxMaxPerSender; i++ {
		req := sender.signedSend(recipient.addr, now.UnixMilli(), nonceN(i), "inv", "p")
		if _, _, err := store.Put(req); err != nil {
			t.Fatalf("send %d rejected: %v", i, err)
		}
	}
	req := sender.signedSend(recipient.addr, now.UnixMilli(), nonceN(inboxMaxPerSender), "inv", "p")
	if _, _, err := store.Put(req); err != errTooMany {
		t.Fatalf("11th send: want errTooMany, got %v", err)
	}
}

func TestInboxPutMailboxCapConcurrent(t *testing.T) {
	now := time.Now()
	store := testStore(t, now)
	recipient := newInboxSender(t)

	// Fill to 90 from 9 senders (respecting the per-sender cap of 10).
	for s := 0; s < 9; s++ {
		snd := newInboxSender(t)
		for i := 0; i < 10; i++ {
			req := snd.signedSend(recipient.addr, now.UnixMilli(), nonceN(s*10+i), "inv", "p")
			if _, _, err := store.Put(req); err != nil {
				t.Fatal(err)
			}
		}
	}
	// 20 concurrent sends from 20 fresh senders race for the last 10 slots.
	var wg sync.WaitGroup
	errs := make([]error, 20)
	for i := 0; i < 20; i++ {
		snd := newInboxSender(t)
		req := snd.signedSend(recipient.addr, now.UnixMilli(), nonceN(90+i), "inv", "p")
		wg.Add(1)
		go func(i int, r InboxSendRequest) {
			defer wg.Done()
			_, _, errs[i] = store.Put(r)
		}(i, req)
	}
	wg.Wait()

	entries, err := os.ReadDir(filepath.Join(store.dir, compactAddress(recipient.addr)))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != inboxMaxMailbox {
		t.Fatalf("mailbox has %d files, want exactly %d", len(entries), inboxMaxMailbox)
	}
	tooMany := 0
	for _, e := range errs {
		if e == errTooMany {
			tooMany++
		}
	}
	if tooMany != 10 {
		t.Fatalf("want 10 errTooMany, got %d", tooMany)
	}
}
```

- [ ] **Step 2: Run to verify failure**: `cd backend && go test ./... -run TestInboxPut` → FAIL: `undefined: NewInboxStore`.

- [ ] **Step 3: Implement** `backend/inbox_store.go`:

```go
package main

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
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
	sentAt := time.UnixMilli(req.SentAt)
	if sentAt.Before(now.Add(-inboxSendWindow)) || sentAt.After(now.Add(inboxSendWindow)) {
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
```

- [ ] **Step 4: Run tests**: `cd backend && go test ./...` → PASS. The concurrency test must pass with `-race`: `go test -race ./... -run TestInboxPutMailboxCapConcurrent` → PASS.

- [ ] **Step 5: Commit**: `git add backend/inbox_store.go backend/inbox_store_test.go && git commit -m "feat(backend): inbox store Put with replay idempotency and quota caps"`

---

### Task 4: InboxStore List (retention sweep, ordering) and Delete (backend)

**Files:**
- Modify: `backend/inbox_store.go`
- Test: `backend/inbox_store_test.go` (append)

**Interfaces:**
- Consumes: Task 3's store internals.
- Produces (used by Task 5):
  - `func (s *InboxStore) List(address string) ([]InboxMessage, error)` — sweeps retention, returns oldest-first by `ReceivedAt`, `[]` never nil for empty.
  - `func (s *InboxStore) Delete(address, id string) error` — `errBadRequest` for malformed id/address, `errNotFound` when absent.

- [ ] **Step 1: Write failing tests** (append to `backend/inbox_store_test.go`):

```go
func TestInboxListOrdersOldestFirstAndSweeps(t *testing.T) {
	now := time.Now()
	store := testStore(t, now)
	recipient := newInboxSender(t)
	sender := newInboxSender(t)

	// Two live messages sent "now", written with controlled received_at below.
	for i, age := range []time.Duration{2 * time.Hour, 1 * time.Hour} {
		req := sender.signedSend(recipient.addr, now.UnixMilli(), nonceN(i), "inv", "p")
		store.now = func() time.Time { return now.Add(-age) }
		if _, _, err := store.Put(req); err != nil {
			t.Fatal(err)
		}
	}
	// One message exactly past retention: write directly with old received_at.
	old := InboxMessage{
		Version: 1, Type: "payment-request", ID: newMessageID(), ObjectID: "x",
		Nonce: nonceN(9), Sender: sender.addr, Recipient: recipient.addr,
		Payload: "p", SentAt: 1, ReceivedAt: now.Add(-inboxRetention - time.Millisecond).UnixMilli(),
	}
	if err := store.writeMessage(compactAddress(recipient.addr), old); err != nil {
		t.Fatal(err)
	}

	store.now = func() time.Time { return now }
	msgs, err := store.List(recipient.addr)
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 2 {
		t.Fatalf("want 2 after sweep, got %d", len(msgs))
	}
	if msgs[0].ReceivedAt > msgs[1].ReceivedAt {
		t.Fatal("not oldest-first")
	}
	if _, err := os.Stat(filepath.Join(store.dir, compactAddress(recipient.addr), old.ID+".json")); !os.IsNotExist(err) {
		t.Fatal("expired message not deleted")
	}
}

func TestInboxListSkipsCorruptFile(t *testing.T) {
	now := time.Now()
	store := testStore(t, now)
	recipient := newInboxSender(t)
	sender := newInboxSender(t)
	req := sender.signedSend(recipient.addr, now.UnixMilli(), testNonce, "inv", "p")
	if _, _, err := store.Put(req); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(store.dir, compactAddress(recipient.addr))
	corruptID := newMessageID()
	if err := os.WriteFile(filepath.Join(dir, corruptID+".json"), []byte("{truncated"), 0o600); err != nil {
		t.Fatal(err)
	}
	msgs, err := store.List(recipient.addr)
	if err != nil || len(msgs) != 1 {
		t.Fatalf("corrupt file broke read: %d msgs, err=%v", len(msgs), err)
	}
	if _, err := os.Stat(filepath.Join(dir, corruptID+".json.corrupt")); err != nil {
		t.Fatal("corrupt file not quarantined")
	}
}

func TestInboxListEmptyAndInvalid(t *testing.T) {
	store := testStore(t, time.Now())
	recipient := newInboxSender(t)
	msgs, err := store.List(recipient.addr)
	if err != nil || msgs == nil || len(msgs) != 0 {
		t.Fatalf("empty mailbox: msgs=%v err=%v (want non-nil empty slice)", msgs, err)
	}
	if _, err := store.List("../../etc"); err != errBadRequest {
		t.Fatalf("invalid address: want errBadRequest, got %v", err)
	}
}

func TestInboxDelete(t *testing.T) {
	now := time.Now()
	store := testStore(t, now)
	recipient := newInboxSender(t)
	sender := newInboxSender(t)
	id, _, err := store.Put(sender.signedSend(recipient.addr, now.UnixMilli(), testNonce, "inv", "p"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(recipient.addr, id); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(recipient.addr, id); err != errNotFound {
		t.Fatalf("second delete: want errNotFound, got %v", err)
	}
	if err := store.Delete(recipient.addr, "../escape"); err != errBadRequest {
		t.Fatalf("traversal id: want errBadRequest, got %v", err)
	}
}
```

- [ ] **Step 2: Run to verify failure**: `cd backend && go test ./... -run 'TestInboxList|TestInboxDelete'` → FAIL: `store.List undefined`.

- [ ] **Step 3: Implement** — append to `backend/inbox_store.go` (add `"sort"` to imports):

```go
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
```

- [ ] **Step 4: Run tests**: `cd backend && go test ./...` → PASS.

- [ ] **Step 5: Commit**: `git add backend/inbox_store.go backend/inbox_store_test.go && git commit -m "feat(backend): inbox List with retention sweep and Delete"`

---

### Task 5: Inbox HTTP handlers, read-capability auth, routes (backend)

**Files:**
- Create: `backend/inbox_handlers.go`
- Modify: `backend/main.go`
- Test: `backend/inbox_handlers_test.go`

**Interfaces:**
- Consumes: `InboxStore` (Tasks 3–4), `verifySignedMessage` (Task 1), `inboxReadMessage` (Task 2).
- Produces: HTTP API used by Task 7 client:
  - `POST /api/inbox/messages` → 201 `{"id":...}`, 200 `{"id":...}` on replay, 400/401/409/429 `{"error":...}`
  - `GET /api/inbox/{address}/messages` → 200 `{"messages":[...]}` (oldest first); auth headers `X-Inbox-Public-Key`, `X-Inbox-Signature`, `X-Inbox-Issued-At` (unix ms)
  - `DELETE /api/inbox/{address}/messages/{id}` → 204 / 404
  - Env var `INBOX_DIR` (default `/data/inbox`)

- [ ] **Step 1: Write failing tests** in `backend/inbox_handlers_test.go`:

```go
package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func inboxTestServer(t *testing.T, now time.Time) (*httptest.Server, *InboxStore) {
	t.Helper()
	store := testStore(t, now)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/inbox/messages", inboxPostHandler(store))
	mux.HandleFunc("GET /api/inbox/{address}/messages", inboxListHandler(store))
	mux.HandleFunc("DELETE /api/inbox/{address}/messages/{id}", inboxDeleteHandler(store))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, store
}

func (s inboxTestSender) readAuthHeaders(t *testing.T, issuedAt int64) http.Header {
	t.Helper()
	msg := inboxReadMessage(s.addr, issuedAt)
	hash := nimiqSignedMessageHash(msg)
	sig := ed25519.Sign(s.priv, hash[:])
	h := http.Header{}
	h.Set("X-Inbox-Public-Key", hex.EncodeToString(s.pub))
	h.Set("X-Inbox-Signature", hex.EncodeToString(sig))
	h.Set("X-Inbox-Issued-At", strconv.FormatInt(issuedAt, 10))
	return h
}

func postJSON(t *testing.T, url string, body any) *http.Response {
	t.Helper()
	data, _ := json.Marshal(body)
	res, err := http.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestInboxEndToEnd(t *testing.T) {
	now := time.Now()
	srv, _ := inboxTestServer(t, now)
	sender := newInboxSender(t)
	recipient := newInboxSender(t)
	req := sender.signedSend(recipient.addr, now.UnixMilli(), testNonce, "inv-1", "nimiq:X?amount=1")

	// POST → 201
	res := postJSON(t, srv.URL+"/api/inbox/messages", req)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("post: %d", res.StatusCode)
	}
	var created struct{ ID string `json:"id"` }
	json.NewDecoder(res.Body).Decode(&created)

	// Replay → 200, same id
	res = postJSON(t, srv.URL+"/api/inbox/messages", req)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("replay: %d", res.StatusCode)
	}

	// GET without auth → 401
	getReq, _ := http.NewRequest("GET", srv.URL+"/api/inbox/"+compactAddress(recipient.addr)+"/messages", nil)
	res, _ = http.DefaultClient.Do(getReq)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated get: %d", res.StatusCode)
	}

	// GET with valid capability → 200, 1 message
	getReq.Header = recipient.readAuthHeaders(t, now.UnixMilli())
	res, _ = http.DefaultClient.Do(getReq)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get: %d", res.StatusCode)
	}
	var listed struct{ Messages []InboxMessage `json:"messages"` }
	json.NewDecoder(res.Body).Decode(&listed)
	if len(listed.Messages) != 1 || listed.Messages[0].ID != created.ID {
		t.Fatalf("listed %d messages", len(listed.Messages))
	}

	// Sender's capability must NOT read the recipient's mailbox
	getReq2, _ := http.NewRequest("GET", srv.URL+"/api/inbox/"+compactAddress(recipient.addr)+"/messages", nil)
	getReq2.Header = sender.readAuthHeaders(t, now.UnixMilli())
	res, _ = http.DefaultClient.Do(getReq2)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("cross-mailbox read: %d", res.StatusCode)
	}

	// DELETE → 204, then 404
	delURL := srv.URL + "/api/inbox/" + compactAddress(recipient.addr) + "/messages/" + created.ID
	delReq, _ := http.NewRequest("DELETE", delURL, nil)
	delReq.Header = recipient.readAuthHeaders(t, now.UnixMilli())
	res, _ = http.DefaultClient.Do(delReq)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: %d", res.StatusCode)
	}
	delReq2, _ := http.NewRequest("DELETE", delURL, nil)
	delReq2.Header = recipient.readAuthHeaders(t, now.UnixMilli())
	res, _ = http.DefaultClient.Do(delReq2)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("second delete: %d", res.StatusCode)
	}
}

func TestInboxReadCapabilityExpiry(t *testing.T) {
	now := time.Now()
	srv, _ := inboxTestServer(t, now)
	recipient := newInboxSender(t)
	url := srv.URL + "/api/inbox/" + compactAddress(recipient.addr) + "/messages"

	// Exactly at max age → still accepted
	req, _ := http.NewRequest("GET", url, nil)
	req.Header = recipient.readAuthHeaders(t, now.Add(-inboxReadMaxAge).UnixMilli())
	res, _ := http.DefaultClient.Do(req)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("capability at boundary: %d", res.StatusCode)
	}
	// Past max age → 401
	req2, _ := http.NewRequest("GET", url, nil)
	req2.Header = recipient.readAuthHeaders(t, now.Add(-inboxReadMaxAge-time.Minute).UnixMilli())
	res, _ = http.DefaultClient.Do(req2)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired capability: %d", res.StatusCode)
	}
}

func TestInboxPostErrorMapping(t *testing.T) {
	now := time.Now()
	srv, _ := inboxTestServer(t, now)
	sender := newInboxSender(t)
	recipient := newInboxSender(t)

	bad := sender.signedSend(recipient.addr, now.UnixMilli(), testNonce, "inv", "p")
	bad.Payload += "tamper"
	if res := postJSON(t, srv.URL+"/api/inbox/messages", bad); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("tampered: %d", res.StatusCode)
	}
	stale := sender.signedSend(recipient.addr, now.Add(-time.Hour).UnixMilli(), testNonce, "inv", "p")
	if res := postJSON(t, srv.URL+"/api/inbox/messages", stale); res.StatusCode != http.StatusConflict {
		t.Fatalf("stale: %d", res.StatusCode)
	}
	malformed := sender.signedSend(recipient.addr, now.UnixMilli(), "zz", "inv", "p")
	if res := postJSON(t, srv.URL+"/api/inbox/messages", malformed); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("malformed: %d", res.StatusCode)
	}
}
```

- [ ] **Step 2: Run to verify failure**: `cd backend && go test ./... -run TestInbox` → FAIL: `undefined: inboxPostHandler`.

- [ ] **Step 3: Implement** `backend/inbox_handlers.go`:

```go
package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"
)

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func inboxPostHandler(store *InboxStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req InboxSendRequest
		r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		id, replay, err := store.Put(req)
		switch {
		case errors.Is(err, errBadRequest):
			writeJSONError(w, http.StatusBadRequest, "invalid request")
		case errors.Is(err, errUnauthorized):
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
		case errors.Is(err, errConflict):
			writeJSONError(w, http.StatusConflict, "sent_at outside accepted window")
		case errors.Is(err, errTooMany):
			writeJSONError(w, http.StatusTooManyRequests, "mailbox full")
		case err != nil:
			log.Printf("inbox post error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "inbox unavailable")
		default:
			w.Header().Set("Content-Type", "application/json")
			if replay {
				w.WriteHeader(http.StatusOK)
			} else {
				w.WriteHeader(http.StatusCreated)
			}
			json.NewEncoder(w).Encode(map[string]string{"id": id})
		}
	}
}

// inboxReadAuth verifies the replayable read capability headers for a mailbox.
func inboxReadAuth(r *http.Request, address string, now time.Time) error {
	issuedAt, err := strconv.ParseInt(r.Header.Get("X-Inbox-Issued-At"), 10, 64)
	if err != nil {
		return errUnauthorized
	}
	issued := time.UnixMilli(issuedAt)
	if issued.Before(now.Add(-inboxReadMaxAge)) || issued.After(now.Add(inboxSendWindow)) {
		return errUnauthorized
	}
	if err := verifySignedMessage(
		address,
		r.Header.Get("X-Inbox-Public-Key"),
		r.Header.Get("X-Inbox-Signature"),
		inboxReadMessage(address, issuedAt),
	); err != nil {
		return errUnauthorized
	}
	return nil
}

func inboxListHandler(store *InboxStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		if !isValidNimiqAddress(address) {
			writeJSONError(w, http.StatusBadRequest, "invalid address")
			return
		}
		if err := inboxReadAuth(r, address, store.now()); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		msgs, err := store.List(address)
		if err != nil {
			log.Printf("inbox list error address=%q err=%q", compactAddress(address), err)
			writeJSONError(w, http.StatusInternalServerError, "inbox unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"messages": msgs})
	}
}

func inboxDeleteHandler(store *InboxStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		if !isValidNimiqAddress(address) {
			writeJSONError(w, http.StatusBadRequest, "invalid address")
			return
		}
		if err := inboxReadAuth(r, address, store.now()); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		err := store.Delete(address, r.PathValue("id"))
		switch {
		case errors.Is(err, errBadRequest):
			writeJSONError(w, http.StatusBadRequest, "invalid message id")
		case errors.Is(err, errNotFound):
			writeJSONError(w, http.StatusNotFound, "not found")
		case err != nil:
			log.Printf("inbox delete error address=%q err=%q", compactAddress(address), err)
			writeJSONError(w, http.StatusInternalServerError, "inbox unavailable")
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}
}
```

- [ ] **Step 4: Wire routes** in `backend/main.go` — after the `backupStore` lines add:

```go
	inboxStore := NewInboxStore(getEnv("INBOX_DIR", "/data/inbox"))
```

and after the backup routes:

```go
	mux.HandleFunc("POST /api/inbox/messages", inboxPostHandler(inboxStore))
	mux.HandleFunc("GET /api/inbox/{address}/messages", inboxListHandler(inboxStore))
	mux.HandleFunc("DELETE /api/inbox/{address}/messages/{id}", inboxDeleteHandler(inboxStore))
```

- [ ] **Step 5: Run all backend tests**: `cd backend && go test -race ./...` → PASS. Also `go vet ./...` → clean.

- [ ] **Step 6: Document deployment note** — append to `backend/README.md`:

```markdown
## Inbox rate limiting

App-level inbox limits (100/mailbox, 10/sender, nonce idempotency) are
wallet-independent. Per-IP rate limiting is deliberately left to the reverse
proxy — add to the nginx server block in front of the API:

    limit_req_zone $binary_remote_addr zone=inbox:1m rate=10r/m;
    location /api/inbox/ { limit_req zone=inbox burst=20 nodelay; proxy_pass ...; }

Mount `INBOX_DIR` (default `/data/inbox`) on the same volume as backups.
```

- [ ] **Step 7: Commit**: `git add backend/inbox_handlers.go backend/inbox_handlers_test.go backend/main.go backend/README.md && git commit -m "feat(backend): inbox HTTP endpoints with capability auth"`

---

### Task 6: Frontend types and Dexie v3 migration

**Files:**
- Modify: `src/types/profile.ts`
- Modify: `src/db/db.ts`
- Test: `src/db/db.test.ts` (append)

**Interfaces (produced, used by Tasks 7–9):**
- `InboxImportStatus`, `InboxItem` types.
- `db.inboxItems: Table<InboxItem, string>` (indexes: `id, objectId, sender, status`).
- `db.kv: Table<KvEntry, string>` — `interface KvEntry { key: string; value: unknown }`, used for the cached read capability.

- [ ] **Step 1: Add types** to `src/types/profile.ts`:

```ts
export type InboxImportStatus = 'actionable' | 'unsupported' | 'invalid' | 'dismissed' | 'paid'

/** A message imported from the server mailbox. Local copy is the source of truth. */
export interface InboxItem {
  /** Server message id (delivery attempt) */
  id: string
  /** Stable logical id of the invoice/split/request — reminders reuse it */
  objectId: string
  /** Envelope type, e.g. 'payment-request'; unknown types stay 'unsupported' */
  type: string
  /** Normalized NQ address of the signed sender */
  sender: string
  payload: string
  sentAt: number
  receivedAt: number
  status: InboxImportStatus
  importedAt: number
  /** Number of times a reminder re-delivered this objectId */
  reminders: number
}

export interface KvEntry {
  key: string
  value: unknown
}
```

- [ ] **Step 2: Add Dexie version** in `src/db/db.ts`:

```ts
import Dexie, { type Table } from 'dexie'
import type { Invoice, Profile, InboxItem, KvEntry } from '../types/profile'

class NimConnectDB extends Dexie {
  profiles!: Table<Profile, string>
  invoices!: Table<Invoice, string>
  inboxItems!: Table<InboxItem, string>
  kv!: Table<KvEntry, string>

  constructor() {
    super('nimconnect')
    // Future fields = new this.version(n).stores(...) migrations, never a meta blob.
    this.version(1).stores({
      profiles: 'id, &address',
    })
    this.version(2).stores({
      profiles: 'id, &address',
      invoices: 'id, address, status',
    })
    this.version(3).stores({
      profiles: 'id, &address',
      invoices: 'id, address, status',
      inboxItems: 'id, objectId, sender, status',
      kv: 'key',
    })
  }
}

export const db = new NimConnectDB()
```

- [ ] **Step 3: Append a smoke test** to `src/db/db.test.ts` following the existing test style in that file (read it first; it already sets up Dexie for tests):

```ts
it('stores and indexes inbox items', async () => {
  await db.inboxItems.add({
    id: 'm1', objectId: 'inv-1', type: 'payment-request',
    sender: 'NQ11 TEST', payload: 'nimiq:X', sentAt: 1, receivedAt: 2,
    status: 'actionable', importedAt: 3, reminders: 0,
  })
  expect(await db.inboxItems.where('objectId').equals('inv-1').count()).toBe(1)
  await db.kv.put({ key: 'k', value: { a: 1 } })
  expect((await db.kv.get('k'))?.value).toEqual({ a: 1 })
})
```

- [ ] **Step 4: Run**: `npm test -- src/db` → PASS.

- [ ] **Step 5: Commit**: `git add src/types/profile.ts src/db/db.ts src/db/db.test.ts && git commit -m "feat: inbox item types and dexie v3 tables"`

---

### Task 7: Inbox client service — canonical messages, send, capability, fetch, delete

**Files:**
- Create: `src/services/inbox.ts`
- Test: `src/services/inbox.test.ts`

**Interfaces:**
- Consumes: `signChallenge` from `./nimiq`, `apiUrl`/`hasApiBase` from `./api`, `db` from `../db/db`.
- Produces (used by Tasks 8–9):
  - `interface InboxEnvelope { version: number; type: string; id: string; object_id: string; nonce: string; sender: string; recipient: string; payload: string; sent_at: number; received_at: number; public_key: string; signature: string }`
  - `buildSendMessage(fields: { sender: string; recipient: string; sentAt: number; nonce: string; objectId: string; payloadHash: string }): string`
  - `buildReadMessage(address: string, issuedAt: number): string`
  - `sha256Hex(text: string): Promise<string>`
  - `newNonce(): string`
  - `capabilityFresh(issuedAt: number, now?: number): boolean` (14 days)
  - `sendPaymentRequest(input: { recipient: string; payload: string; objectId: string; sender: string }): Promise<void>`
  - `fetchInbox(address: string): Promise<InboxEnvelope[]>`
  - `deleteInboxMessage(address: string, id: string): Promise<void>`
  - `inboxAvailable(): boolean`

- [ ] **Step 1: Write failing tests** in `src/services/inbox.test.ts` (pure parts only; network functions are exercised in Task 8's pipeline tests via injection and manually in Task 10):

```ts
import { describe, expect, it } from 'vitest'
import { buildSendMessage, buildReadMessage, sha256Hex, newNonce, capabilityFresh } from './inbox'

describe('inbox canonical messages', () => {
  it('builds the send message exactly as the backend expects', () => {
    expect(buildSendMessage({
      sender: 'NQ11 aaaa', recipient: 'nq22 BBBB', sentAt: 42,
      nonce: 'abc', objectId: 'obj-1', payloadHash: 'deadbeef',
    })).toBe(
      'nimconnect:inbox:send:v1\nsender=NQ11AAAA\nrecipient=NQ22BBBB\nsentAt=42\nnonce=abc\nobjectId=obj-1\npayloadHash=deadbeef',
    )
  })

  it('builds the read message exactly as the backend expects', () => {
    expect(buildReadMessage('nq22 bbbb', 7)).toBe('nimconnect:inbox:read:v1\naddress=NQ22BBBB\nissuedAt=7')
  })

  it('hashes payloads with sha256 hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('generates 32-char lowercase hex nonces, unique per call', () => {
    const a = newNonce()
    const b = newNonce()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })

  it('treats capabilities as fresh for 14 days', () => {
    const now = 1_760_000_000_000
    const day = 24 * 3600 * 1000
    expect(capabilityFresh(now - 13 * day, now)).toBe(true)
    expect(capabilityFresh(now - 15 * day, now)).toBe(false)
    expect(capabilityFresh(now + day, now)).toBe(false) // future-dated is stale
  })
})
```

- [ ] **Step 2: Run to verify failure**: `npm test -- src/services/inbox` → FAIL (module not found).

- [ ] **Step 3: Implement** `src/services/inbox.ts`:

```ts
import { apiUrl, hasApiBase } from './api'
import { signChallenge } from './nimiq'
import { db } from '../db/db'

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

const CAPABILITY_KEY = 'inbox-read-capability'
const CAPABILITY_MAX_AGE = 14 * 24 * 3600 * 1000

/** Wire format of a mailbox message; field semantics in the design spec. */
export interface InboxEnvelope {
  version: number
  type: string
  id: string
  object_id: string
  nonce: string
  sender: string
  recipient: string
  payload: string
  sent_at: number
  received_at: number
  public_key: string
  signature: string
}

interface ReadCapability {
  address: string
  publicKey: string
  signature: string
  issuedAt: number
}

export function buildSendMessage(f: {
  sender: string
  recipient: string
  sentAt: number
  nonce: string
  objectId: string
  payloadHash: string
}): string {
  return 'nimconnect:inbox:send:v1'
    + `\nsender=${compact(f.sender)}`
    + `\nrecipient=${compact(f.recipient)}`
    + `\nsentAt=${f.sentAt}`
    + `\nnonce=${f.nonce}`
    + `\nobjectId=${f.objectId}`
    + `\npayloadHash=${f.payloadHash}`
}

export function buildReadMessage(address: string, issuedAt: number): string {
  return `nimconnect:inbox:read:v1\naddress=${compact(address)}\nissuedAt=${issuedAt}`
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function capabilityFresh(issuedAt: number, now = Date.now()): boolean {
  return issuedAt <= now && now - issuedAt < CAPABILITY_MAX_AGE
}

export function inboxAvailable(): boolean {
  return hasApiBase()
}

async function inboxErrorMessage(res: Response): Promise<string> {
  if (res.status === 429) return 'Their inbox is full — share a link instead.'
  if (res.status === 401) return 'Wallet signature was rejected. Use Nimiq Pay with the same wallet as your profile.'
  try {
    const body = await res.json() as { error?: string }
    if (body.error) return `Inbox request failed: ${body.error}`
  } catch { /* ignore */ }
  return `Inbox request failed (${res.status})`
}

/** Sign a payment request with the wallet and POST it to the recipient's mailbox. */
export async function sendPaymentRequest(input: {
  recipient: string
  payload: string
  objectId: string
  sender: string
}): Promise<void> {
  if (!hasApiBase()) throw new Error('inbox-unavailable')
  const sentAt = Date.now()
  const nonce = newNonce()
  const payloadHash = await sha256Hex(input.payload)
  const message = buildSendMessage({ ...input, sentAt, nonce, payloadHash })
  const { publicKey, signature } = await signChallenge(message)
  const res = await fetch(apiUrl('/api/inbox/messages'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: 1,
      type: 'payment-request',
      object_id: input.objectId,
      nonce,
      sender: input.sender,
      recipient: input.recipient,
      payload: input.payload,
      sent_at: sentAt,
      public_key: publicKey,
      signature,
    }),
  })
  if (!res.ok) throw new Error(await inboxErrorMessage(res))
}

/**
 * Cached replayable read capability (see spec): one wallet signature grants
 * read+delete on our own mailbox for 14 days. Stored in Dexie, not localStorage.
 */
async function readCapability(address: string): Promise<ReadCapability> {
  const cached = (await db.kv.get(CAPABILITY_KEY))?.value as ReadCapability | undefined
  if (cached && compact(cached.address) === compact(address) && capabilityFresh(cached.issuedAt)) {
    return cached
  }
  const issuedAt = Date.now()
  const { publicKey, signature } = await signChallenge(buildReadMessage(address, issuedAt))
  const capability: ReadCapability = { address: compact(address), publicKey, signature, issuedAt }
  await db.kv.put({ key: CAPABILITY_KEY, value: capability })
  return capability
}

function authHeaders(c: ReadCapability): HeadersInit {
  return {
    'X-Inbox-Public-Key': c.publicKey,
    'X-Inbox-Signature': c.signature,
    'X-Inbox-Issued-At': String(c.issuedAt),
  }
}

export async function fetchInbox(address: string): Promise<InboxEnvelope[]> {
  if (!hasApiBase()) return []
  const capability = await readCapability(address)
  const res = await fetch(apiUrl(`/api/inbox/${encodeURIComponent(compact(address))}/messages`), {
    headers: authHeaders(capability),
  })
  if (!res.ok) throw new Error(await inboxErrorMessage(res))
  const body = await res.json() as { messages?: InboxEnvelope[] }
  return body.messages ?? []
}

export async function deleteInboxMessage(address: string, id: string): Promise<void> {
  if (!hasApiBase()) return
  const capability = await readCapability(address)
  const res = await fetch(
    apiUrl(`/api/inbox/${encodeURIComponent(compact(address))}/messages/${encodeURIComponent(id)}`),
    { method: 'DELETE', headers: authHeaders(capability) },
  )
  if (!res.ok && res.status !== 404) throw new Error(await inboxErrorMessage(res))
}
```

- [ ] **Step 4: Run**: `npm test -- src/services/inbox` → PASS. Also `npx vue-tsc --noEmit` (or the repo's `npm run build`) → clean.

- [ ] **Step 5: Commit**: `git add src/services/inbox.ts src/services/inbox.test.ts && git commit -m "feat: inbox client service with signed send and cached read capability"`

---

### Task 8: Import pipeline — classify, dedup, reminders, import-before-delete

**Files:**
- Create: `src/services/inbox-import.ts`
- Test: `src/services/inbox-import.test.ts`

**Interfaces:**
- Consumes: `InboxEnvelope` (Task 7), `parsePaymentRequest` from `./links`, `InboxItem`/`InboxImportStatus` types (Task 6).
- Produces (used by Task 9):
  - `classifyEnvelope(env: InboxEnvelope): InboxImportStatus`
  - `interface ImportDeps { getById(id: string): Promise<InboxItem | undefined>; getByObjectId(objectId: string, sender: string): Promise<InboxItem | undefined>; put(item: InboxItem): Promise<void>; deleteRemote(id: string): Promise<void> }`
  - `importEnvelopes(envelopes: InboxEnvelope[], deps: ImportDeps): Promise<{ added: number; reminded: number }>`

- [ ] **Step 1: Write failing tests** in `src/services/inbox-import.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { classifyEnvelope, importEnvelopes, type ImportDeps } from './inbox-import'
import type { InboxEnvelope } from './inbox'
import type { InboxItem } from '../types/profile'

// Valid mainnet-format address pair for tests (checksum-valid).
const SENDER = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const OTHER = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

function env(overrides: Partial<InboxEnvelope> = {}): InboxEnvelope {
  return {
    version: 1,
    type: 'payment-request',
    id: 'msg-1',
    object_id: 'inv-1',
    nonce: 'a'.repeat(32),
    sender: SENDER,
    recipient: OTHER,
    payload: `nimiq:${SENDER.replace(/\s+/g, '')}?amount=12345&message=Invoice`,
    sent_at: 1,
    received_at: 2,
    public_key: 'pk',
    signature: 'sig',
    ...overrides,
  }
}

describe('classifyEnvelope', () => {
  it('accepts a payment request whose destination is the signed sender', () => {
    expect(classifyEnvelope(env())).toBe('actionable')
  })
  it('marks unknown versions and types unsupported', () => {
    expect(classifyEnvelope(env({ version: 2 }))).toBe('unsupported')
    expect(classifyEnvelope(env({ type: 'chat' }))).toBe('unsupported')
  })
  it('marks unparseable payloads invalid', () => {
    expect(classifyEnvelope(env({ payload: 'not a link' }))).toBe('invalid')
  })
  it('marks destination != signed sender invalid (impersonation guard)', () => {
    expect(classifyEnvelope(env({ payload: `nimiq:${OTHER.replace(/\s+/g, '')}?amount=1` }))).toBe('invalid')
  })
})

function makeDeps(existing: InboxItem[] = []) {
  const items = new Map(existing.map(i => [i.id, i]))
  const deleted: string[] = []
  const deps: ImportDeps = {
    getById: async id => items.get(id),
    getByObjectId: async (objectId, sender) =>
      [...items.values()].find(i => i.objectId === objectId && i.sender === sender),
    put: async item => { items.set(item.id, item) },
    deleteRemote: async id => { deleted.push(id) },
  }
  return { deps, items, deleted }
}

describe('importEnvelopes', () => {
  it('imports then deletes remotely', async () => {
    const { deps, items, deleted } = makeDeps()
    const result = await importEnvelopes([env()], deps)
    expect(result.added).toBe(1)
    expect(items.get('msg-1')?.status).toBe('actionable')
    expect(deleted).toEqual(['msg-1'])
  })

  it('keeps unsupported messages on the server', async () => {
    const { deps, items, deleted } = makeDeps()
    await importEnvelopes([env({ type: 'future-thing' })], deps)
    expect(items.get('msg-1')?.status).toBe('unsupported')
    expect(deleted).toEqual([])
  })

  it('dedups by message id (redelivery after failed delete)', async () => {
    const { deps, deleted } = makeDeps([{
      id: 'msg-1', objectId: 'inv-1', type: 'payment-request', sender: SENDER,
      payload: 'p', sentAt: 1, receivedAt: 2, status: 'actionable', importedAt: 3, reminders: 0,
    }])
    const result = await importEnvelopes([env()], deps)
    expect(result.added).toBe(0)
    expect(deleted).toEqual(['msg-1']) // retries the delete, adds nothing
  })

  it('treats a new message with a known objectId as a reminder', async () => {
    const { deps, items, deleted } = makeDeps([{
      id: 'msg-0', objectId: 'inv-1', type: 'payment-request', sender: SENDER,
      payload: 'p', sentAt: 1, receivedAt: 1, status: 'actionable', importedAt: 1, reminders: 0,
    }])
    const result = await importEnvelopes([env({ id: 'msg-2', received_at: 9 })], deps)
    expect(result.reminded).toBe(1)
    const item = items.get('msg-0')!
    expect(item.reminders).toBe(1)
    expect(item.receivedAt).toBe(9)
    expect(deleted).toEqual(['msg-2'])
  })

  it('a failed remote delete does not lose the local import', async () => {
    const { deps, items } = makeDeps()
    deps.deleteRemote = vi.fn().mockRejectedValue(new Error('network'))
    const result = await importEnvelopes([env()], deps)
    expect(result.added).toBe(1)
    expect(items.get('msg-1')?.status).toBe('actionable')
  })
})
```

- [ ] **Step 2: Run to verify failure**: `npm test -- src/services/inbox-import` → FAIL (module not found).

- [ ] **Step 3: Implement** `src/services/inbox-import.ts`:

```ts
import { parsePaymentRequest } from './links'
import type { InboxEnvelope } from './inbox'
import type { InboxImportStatus, InboxItem } from '../types/profile'

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

/**
 * Classify an envelope at the client trust boundary. The critical rule:
 * a request is only actionable when the payment destination equals the
 * wallet-signed sender — otherwise a sender could impersonate a trusted
 * contact while routing funds elsewhere.
 */
export function classifyEnvelope(env: InboxEnvelope): InboxImportStatus {
  if (env.version !== 1 || env.type !== 'payment-request') return 'unsupported'
  const parsed = parsePaymentRequest(env.payload)
  if (!parsed) return 'invalid'
  if (compact(parsed.recipient) !== compact(env.sender)) return 'invalid'
  if (parsed.amountNim != null && !(Number.isFinite(parsed.amountNim) && parsed.amountNim > 0)) return 'invalid'
  return 'actionable'
}

export interface ImportDeps {
  getById(id: string): Promise<InboxItem | undefined>
  getByObjectId(objectId: string, sender: string): Promise<InboxItem | undefined>
  put(item: InboxItem): Promise<void>
  deleteRemote(id: string): Promise<void>
}

/**
 * Import-before-delete: a message is only removed from the server after the
 * local write succeeded. Unsupported messages are kept on the server for a
 * future client version. Failed deletes are retried implicitly on the next
 * poll (id dedup makes redelivery a no-op).
 */
export async function importEnvelopes(
  envelopes: InboxEnvelope[],
  deps: ImportDeps,
): Promise<{ added: number; reminded: number }> {
  let added = 0
  let reminded = 0
  const sorted = [...envelopes].sort((a, b) => a.received_at - b.received_at)

  for (const env of sorted) {
    const safeDelete = () => deps.deleteRemote(env.id).catch(() => {})

    if (await deps.getById(env.id)) {
      await safeDelete() // redelivery after a failed delete
      continue
    }

    const sender = env.sender
    const existing = env.object_id ? await deps.getByObjectId(env.object_id, sender) : undefined
    if (existing) {
      await deps.put({
        ...existing,
        payload: env.payload,
        sentAt: env.sent_at,
        receivedAt: env.received_at,
        reminders: existing.reminders + 1,
        // A reminder re-opens a dismissed request; paid stays paid.
        status: existing.status === 'dismissed' ? 'actionable' : existing.status,
      })
      reminded++
      await safeDelete()
      continue
    }

    const status = classifyEnvelope(env)
    await deps.put({
      id: env.id,
      objectId: env.object_id,
      type: env.type,
      sender,
      payload: env.payload,
      sentAt: env.sent_at,
      receivedAt: env.received_at,
      status,
      importedAt: Date.now(),
      reminders: 0,
    })
    added++
    if (status !== 'unsupported') await safeDelete()
  }
  return { added, reminded }
}
```

- [ ] **Step 4: Run**: `npm test -- src/services/inbox-import` → PASS. Then full suite: `npm test` → PASS.

- [ ] **Step 5: Commit**: `git add src/services/inbox-import.ts src/services/inbox-import.test.ts && git commit -m "feat: inbox import pipeline with impersonation guard and reminder dedup"`

---

### Task 9: Inbox Pinia store, Activity page UI, nav badge

**Files:**
- Create: `src/stores/inbox.ts`
- Create: `src/components/InboxRequestCard.vue`
- Modify: `src/pages/ActivityPage.vue`
- Modify: `src/App.vue` (nav badge)
- Test: `src/stores/inbox.test.ts`

**Interfaces:**
- Consumes: Tasks 6–8 plus `useProfilesStore`, `sendNim` from `../services/nimiq`, `parsePaymentRequest` from `../services/links`.
- Produces: `useInboxStore` with `items`, `actionable`, `badgeCount`, `load()`, `refresh()`, `pay(item)`, `dismiss(item)`.

- [ ] **Step 1: Write the store test** in `src/stores/inbox.test.ts` (mirror the setup style of `src/stores/invoices.test.ts` — read it first; it shows how the repo activates Pinia and fakes Dexie). Test the pure store logic with mocked services:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../services/inbox', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/inbox')>()),
  fetchInbox: vi.fn().mockResolvedValue([]),
  deleteInboxMessage: vi.fn().mockResolvedValue(undefined),
  inboxAvailable: () => true,
}))
vi.mock('../services/nimiq', () => ({
  sendNim: vi.fn().mockResolvedValue('txhash'),
}))

import { useInboxStore } from './inbox'
import { db } from '../db/db'

const SENDER = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

describe('inbox store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.inboxItems.clear()
  })

  it('badgeCount counts only actionable items', async () => {
    await db.inboxItems.bulkAdd([
      { id: 'a', objectId: 'o1', type: 'payment-request', sender: SENDER, payload: `nimiq:${SENDER.replace(/\s+/g, '')}?amount=100000`, sentAt: 1, receivedAt: 1, status: 'actionable', importedAt: 1, reminders: 0 },
      { id: 'b', objectId: 'o2', type: 'x', sender: SENDER, payload: 'p', sentAt: 1, receivedAt: 1, status: 'unsupported', importedAt: 1, reminders: 0 },
      { id: 'c', objectId: 'o3', type: 'payment-request', sender: SENDER, payload: 'p', sentAt: 1, receivedAt: 1, status: 'dismissed', importedAt: 1, reminders: 0 },
    ])
    const store = useInboxStore()
    await store.load()
    expect(store.badgeCount).toBe(1)
    expect(store.actionable).toHaveLength(1)
  })

  it('pay sends NIM to the payload destination and marks the item paid', async () => {
    const { sendNim } = await import('../services/nimiq')
    await db.inboxItems.add({ id: 'a', objectId: 'o1', type: 'payment-request', sender: SENDER, payload: `nimiq:${SENDER.replace(/\s+/g, '')}?amount=100000`, sentAt: 1, receivedAt: 1, status: 'actionable', importedAt: 1, reminders: 0 })
    const store = useInboxStore()
    await store.load()
    await store.pay(store.items[0])
    expect(sendNim).toHaveBeenCalledWith(expect.stringContaining('NQ07'), 1, expect.anything())
    expect((await db.inboxItems.get('a'))?.status).toBe('paid')
  })

  it('dismiss marks dismissed and deletes unsupported remotely', async () => {
    const { deleteInboxMessage } = await import('../services/inbox')
    await db.inboxItems.add({ id: 'b', objectId: 'o2', type: 'future', sender: SENDER, payload: 'p', sentAt: 1, receivedAt: 1, status: 'unsupported', importedAt: 1, reminders: 0 })
    const store = useInboxStore()
    await store.load()
    store.selfAddress = SENDER
    await store.dismiss(store.items[0])
    expect((await db.inboxItems.get('b'))?.status).toBe('dismissed')
    expect(deleteInboxMessage).toHaveBeenCalledWith(SENDER, 'b')
  })
})
```

Adapt mock/setup details to whatever `src/stores/invoices.test.ts` actually does (fake-indexeddb import, etc.) — copy its preamble.

- [ ] **Step 2: Run to verify failure**: `npm test -- src/stores/inbox` → FAIL (module not found).

- [ ] **Step 3: Implement** `src/stores/inbox.ts`:

```ts
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db } from '../db/db'
import type { InboxItem } from '../types/profile'
import { fetchInbox, deleteInboxMessage, inboxAvailable } from '../services/inbox'
import { importEnvelopes } from '../services/inbox-import'
import { parsePaymentRequest } from '../services/links'
import { sendNim } from '../services/nimiq'

export const useInboxStore = defineStore('inbox', () => {
  const items = ref<InboxItem[]>([])
  const loaded = ref(false)
  const refreshing = ref(false)
  /** Set by the page/App once the self profile is known; needed for polling. */
  const selfAddress = ref<string | null>(null)

  async function load() {
    if (loaded.value) return
    items.value = await db.inboxItems.toArray()
    loaded.value = true
  }

  const actionable = computed(() =>
    items.value.filter(i => i.status === 'actionable').sort((a, b) => b.receivedAt - a.receivedAt),
  )
  const badgeCount = computed(() => actionable.value.length)

  /** Poll the server mailbox and import (import-before-delete, see spec). */
  async function refresh(address?: string) {
    const addr = address ?? selfAddress.value
    if (!addr || !inboxAvailable() || refreshing.value) return
    if (address) selfAddress.value = address
    refreshing.value = true
    try {
      const envelopes = await fetchInbox(addr)
      if (envelopes.length) {
        await importEnvelopes(envelopes, {
          getById: id => db.inboxItems.get(id),
          getByObjectId: async (objectId, sender) =>
            (await db.inboxItems.where('objectId').equals(objectId).toArray())
              .find(i => i.sender.replace(/\s+/g, '') === sender.replace(/\s+/g, '')),
          put: async item => { await db.inboxItems.put(item) },
          deleteRemote: id => deleteInboxMessage(addr, id),
        })
        items.value = await db.inboxItems.toArray()
      }
    } catch {
      // silent per spec — badge stays stale
    } finally {
      refreshing.value = false
    }
  }

  async function setStatus(item: InboxItem, status: InboxItem['status']) {
    const updated = { ...item, status }
    await db.inboxItems.put(updated)
    items.value = items.value.map(i => (i.id === item.id ? updated : i))
  }

  /** Pay the request via the wallet, then mark it paid. */
  async function pay(item: InboxItem) {
    const parsed = parsePaymentRequest(item.payload)
    if (!parsed?.amountNim) throw new Error('invalid-request')
    await sendNim(parsed.recipient, parsed.amountNim, parsed.message)
    await setStatus(item, 'paid')
  }

  async function dismiss(item: InboxItem) {
    // Unsupported messages were left on the server; explicit dismissal removes them.
    if (item.status === 'unsupported' && selfAddress.value) {
      await deleteInboxMessage(selfAddress.value, item.id).catch(() => {})
    }
    await setStatus(item, 'dismissed')
  }

  return { items, loaded, refreshing, selfAddress, actionable, badgeCount, load, refresh, pay, dismiss }
})
```

- [ ] **Step 4: Run store tests**: `npm test -- src/stores/inbox` → PASS.

- [ ] **Step 5: Create** `src/components/InboxRequestCard.vue` — matches the existing Activity card look (classes reuse ActivityPage patterns):

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { InboxItem } from '../types/profile'
import { parsePaymentRequest, shortAddress } from '../services/links'
import Identicon from './Identicon.vue'

const props = defineProps<{
  item: InboxItem
  contactName?: string // undefined = unknown sender
  paying?: boolean
}>()
const emit = defineEmits<{ pay: []; dismiss: [] }>()

const confirming = ref(false)
const parsed = computed(() => parsePaymentRequest(props.item.payload))

function onPay() {
  // Unknown senders always get an explicit confirmation step (spec).
  if (!props.contactName && !confirming.value) {
    confirming.value = true
    return
  }
  confirming.value = false
  emit('pay')
}
</script>

<template>
  <article class="card request-card">
    <div class="request-head">
      <Identicon :address="item.sender" :size="44" />
      <div class="request-title">
        <span class="request-name" :class="{ missing: !contactName }">
          {{ contactName ?? 'Unknown sender' }}
        </span>
        <span class="request-date">
          {{ shortAddress(item.sender) }} · {{ new Date(item.receivedAt).toLocaleDateString() }}
          <span v-if="item.reminders" class="reminder-badge">reminder ×{{ item.reminders }}</span>
        </span>
      </div>
      <div v-if="parsed?.amountNim" class="request-amount">
        {{ parsed.amountNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
      </div>
    </div>

    <p v-if="parsed?.message" class="request-desc">{{ parsed.message }}</p>

    <div v-if="confirming" class="confirm">
      <p>
        You are about to pay someone <strong>not in your contacts</strong>.
        Funds go to:<br /><code>{{ item.sender }}</code>
      </p>
      <div class="request-actions">
        <button type="button" class="action danger-solid" :disabled="paying" @click="onPay">Pay anyway</button>
        <button type="button" class="action" @click="confirming = false">Cancel</button>
      </div>
    </div>
    <div v-else class="request-actions">
      <button v-if="parsed?.amountNim" type="button" class="action primary" :disabled="paying" @click="onPay">
        {{ paying ? 'Paying…' : 'Pay' }}
      </button>
      <button type="button" class="action" @click="emit('dismiss')">Dismiss</button>
    </div>
  </article>
</template>

<style scoped>
.request-card { padding: 14px; }
.request-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.request-title { flex: 1; min-width: 0; }
.request-name { display: block; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.request-name.missing { color: var(--text-2); }
.request-date { display: block; margin-top: 2px; color: var(--text-2); font-size: 12px; }
.reminder-badge {
  display: inline-block; margin-left: 4px; padding: 1px 6px;
  border-radius: var(--nimiq-radius-small); background: var(--text-6);
  font-size: 11px; font-weight: 700; color: var(--nq-gold-dark);
}
.request-amount { text-align: right; font-weight: 700; color: var(--nq-gold-dark); flex: 0 0 auto; }
.request-desc { margin: 12px 0 0; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
.confirm { margin-top: 12px; padding: 10px 12px; border-radius: var(--radius); background: rgba(216, 65, 62, 0.08); font-size: 13px; }
.confirm code { overflow-wrap: anywhere; font-size: 12px; }
.request-actions { display: flex; gap: 8px; margin-top: 12px; }
.request-actions .action {
  min-height: 42px; padding: 0 16px; border: 1px solid var(--border); border-radius: 21px;
  background: var(--bg); color: var(--nq-light-blue); cursor: pointer;
  font: inherit; font-size: 13px; font-weight: 800;
  display: inline-flex; align-items: center; justify-content: center;
}
.request-actions .action.primary { border: none; color: var(--nimiq-white); background: var(--nimiq-gold-bg); }
.request-actions .action.danger-solid { border: none; color: var(--nimiq-white); background: var(--nq-red); }
.request-actions .action:disabled { opacity: 0.5; cursor: default; }
</style>
```

- [ ] **Step 6: Integrate into `src/pages/ActivityPage.vue`.** In the script block add:

```ts
import { useInboxStore } from '../stores/inbox'
import InboxRequestCard from '../components/InboxRequestCard.vue'

const inboxStore = useInboxStore()
const payingId = ref<string | null>(null)
const unknownExpanded = ref(false)

const knownRequests = computed(() => inboxStore.actionable.filter(i => profileFor(i.sender)))
const unknownRequests = computed(() => inboxStore.actionable.filter(i => !profileFor(i.sender)))
const visibleUnknown = computed(() =>
  unknownExpanded.value ? unknownRequests.value : unknownRequests.value.slice(0, 2),
)

async function payRequest(item: (typeof inboxStore.actionable)[number]) {
  payingId.value = item.id
  try {
    await inboxStore.pay(item)
  } catch {
    // wallet popup dismissed or send failed — no state change (spec)
  } finally {
    payingId.value = null
  }
}
```

Extend the existing `onMounted` to also load and poll the inbox:

```ts
onMounted(async () => {
  getRates().then(r => (rates.value = r))
  await Promise.all([profilesStore.load(), invoicesStore.load(), inboxStore.load()])
  await loadIncoming()
  if (profilesStore.self) inboxStore.refresh(profilesStore.self.address)
})
```

In the template, insert a new section between the summary block and the "Open invoices" section:

```vue
    <section v-if="inboxStore.actionable.length" class="activity-section">
      <div class="section-head">
        <h2>Requests for you</h2>
        <button type="button" class="refresh" :disabled="inboxStore.refreshing" @click="inboxStore.refresh()">
          {{ inboxStore.refreshing ? 'Checking…' : 'Refresh' }}
        </button>
      </div>

      <div class="invoice-list">
        <InboxRequestCard
          v-for="item in knownRequests"
          :key="item.id"
          :item="item"
          :contact-name="contactName(item.sender)"
          :paying="payingId === item.id"
          @pay="payRequest(item)"
          @dismiss="inboxStore.dismiss(item)"
        />
      </div>

      <template v-if="unknownRequests.length">
        <div class="section-head unknown-head">
          <h2>Requests from unknown senders ({{ unknownRequests.length }})</h2>
        </div>
        <div class="invoice-list">
          <InboxRequestCard
            v-for="item in visibleUnknown"
            :key="item.id"
            :item="item"
            :paying="payingId === item.id"
            @pay="payRequest(item)"
            @dismiss="inboxStore.dismiss(item)"
          />
        </div>
        <button
          v-if="unknownRequests.length > 2 && !unknownExpanded"
          type="button" class="refresh show-more" @click="unknownExpanded = true"
        >
          Show all {{ unknownRequests.length }}
        </button>
      </template>
    </section>
```

Add to the scoped styles:

```css
.unknown-head { margin-top: 14px; }
.show-more { margin-top: 8px; align-self: center; }
```

- [ ] **Step 7: Nav badge + foreground polling in `src/App.vue`.** In the script, import and set up:

```ts
import { useInboxStore } from './stores/inbox'
const inboxStore = useInboxStore()
inboxStore.load()

// Poll on foreground resume; the store no-ops until a self address is known.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') inboxStore.refresh()
  })
}
```

(Check App.vue's existing script for where the profiles store self address becomes available; set `inboxStore.selfAddress` there or rely on ActivityPage's `refresh(address)` call to seed it.)

In the nav (App.vue line ~86), badge the Activity item:

```vue
      <router-link to="/activity" class="nav-item" :class="{ active: $route.path === '/activity' }">
        <span class="nav-icon">🧾<span v-if="inboxStore.badgeCount" class="nav-badge">{{ inboxStore.badgeCount }}</span></span><span>Activity</span>
      </router-link>
```

Style:

```css
.nav-icon { position: relative; }
.nav-badge {
  position: absolute; top: -4px; right: -10px;
  min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: var(--nq-red); color: var(--nimiq-white);
  font-size: 10px; font-weight: 800; line-height: 16px; text-align: center;
}
```

- [ ] **Step 8: Verify**: `npm test` → PASS; `npm run build` → clean. Then run the dev app (`npm run dev`) and confirm the Activity page renders with no inbox items and no console errors.

- [ ] **Step 9: Commit**: `git add src/stores/inbox.ts src/stores/inbox.test.ts src/components/InboxRequestCard.vue src/pages/ActivityPage.vue src/App.vue && git commit -m "feat: inbox requests on Activity page with unknown-sender isolation and nav badge"`

---

### Task 10: Send UX — "Send to their NimConnect" in InvoiceSheet

**Files:**
- Modify: `src/components/InvoiceSheet.vue`

**Interfaces:**
- Consumes: `sendPaymentRequest` (Task 7), `inboxAvailable` (Task 7), existing `makeRequestLink` / profiles store.

- [ ] **Step 1: Add send action** to `src/components/InvoiceSheet.vue`. Script additions:

```ts
import { sendPaymentRequest, inboxAvailable } from '../services/inbox'

const sendingId = ref<string | null>(null)
const sentId = ref<string | null>(null)
const sendError = ref<string | null>(null)

// Inbox sends must use the self address as destination: the wallet signs with
// the self-address key and recipients reject destination != signed sender.
async function sendToInbox(inv: { id: string; amountNim: number; description: string }) {
  if (!store.self) return
  sendingId.value = inv.id
  sendError.value = null
  try {
    await sendPaymentRequest({
      recipient: props.profile.address,
      payload: makeRequestLink(store.self.address, inv.amountNim, inv.description || 'Invoice'),
      objectId: inv.id,
      sender: store.self.address,
    })
    sentId.value = inv.id
    setTimeout(() => (sentId.value = null), 2500)
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : 'Sending failed'
  } finally {
    sendingId.value = null
  }
}
```

Also import `makeRequestLink` if not already imported (it is — line 6).

- [ ] **Step 2: Template** — inside the existing `detail-actions` div (next to "Copy link"), add. There is no separate "reminder" button: re-tapping *is* the reminder (same `objectId`; server nonce-idempotency plus client objectId-dedup make repeats safe).

```vue
              <button
                v-if="inv.status === 'pending' && inboxAvailable() && store.self"
                type="button"
                class="secondary"
                :disabled="sendingId === inv.id"
                @click="sendToInbox(inv)"
              >
                {{ sentId === inv.id ? 'Sent!' : sendingId === inv.id ? 'Sending…' : 'Send to their NimConnect' }}
              </button>
```

And below the actions, surface errors:

```vue
            <p v-if="sendError && (sendingId === inv.id || sentId === null)" class="hint send-error">{{ sendError }}</p>
```

with style `.send-error { color: var(--nq-red); }`.

- [ ] **Step 3: Verify**: `npm run build` → clean. `npm test` → PASS. In `npm run dev`, open a contact's invoice sheet and confirm the button renders for pending invoices (it will fail at the signature step outside Nimiq Pay — expected; the wallet popup path can only be fully tested inside the host app).

- [ ] **Step 4: Commit**: `git add src/components/InvoiceSheet.vue && git commit -m "feat: send invoice to recipient's NimConnect inbox"`

> **Deliberate deferral:** the spec also names the split flow as a send surface. Splits currently produce share links from `App.vue`'s split sheet without a persisted object to use as `objectId`. Ship the invoice path first; extend to splits in a follow-up once splits have stable local ids. (`ponytail:` invoice-only send, add split sends when splits get persisted ids.)

---

### Task 11: Full verification pass

- [ ] **Step 1: Backend**: `cd backend && go vet ./... && go test -race ./...` → all PASS.
- [ ] **Step 2: Frontend**: `npm test && npm run build` → all PASS/clean.
- [ ] **Step 3: End-to-end smoke** (two terminals):
  - `cd backend && INBOX_DIR=/tmp/claude-inbox go run .`
  - Use the Task 3/5 test key helper approach via `curl`: POST a signed message is impractical by hand — instead run `go test ./... -run TestInboxEndToEnd -v` and treat it as the E2E check, plus manually `curl -i localhost:8787/api/inbox/NQ07.../messages` (no auth) → expect 401, and `curl -i -X POST localhost:8787/api/inbox/messages -d '{}'` → expect 400.
- [ ] **Step 4:** Confirm the working tree has no unrelated changes, then invoke superpowers:verification-before-completion and superpowers:finishing-a-development-branch.
