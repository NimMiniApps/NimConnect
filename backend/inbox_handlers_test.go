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
