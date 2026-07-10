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

func TestInboxListOrdersOldestFirstAndSweeps(t *testing.T) {
	now := time.Now()
	store := testStore(t, now)
	recipient := newInboxSender(t)
	sender := newInboxSender(t)

	// Two live messages sent at fake server time, written with controlled received_at below.
	for i, age := range []time.Duration{2 * time.Hour, 1 * time.Hour} {
		fakeNow := now.Add(-age)
		req := sender.signedSend(recipient.addr, fakeNow.UnixMilli(), nonceN(i), "inv", "p")
		store.now = func() time.Time { return fakeNow }
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
