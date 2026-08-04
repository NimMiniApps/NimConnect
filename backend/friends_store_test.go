package main

import (
	"errors"
	"testing"
	"time"
)

func TestFriendStoreSendRequestCreatesPending(t *testing.T) {
	s := newTestFriendStore(t)
	s.now = func() time.Time { return time.Unix(1_700_000_000, 0) }

	f, err := s.SendRequest(
		"NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD",
		"NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF",
	)
	if err != nil {
		t.Fatal(err)
	}
	if f.Status != FriendshipPending {
		t.Fatalf("status = %q, want pending", f.Status)
	}
	if f.ID == "" {
		t.Fatal("expected non-empty id")
	}
	if compactAddress(f.RequesterAddress) != compactAddress("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD") {
		t.Fatalf("requester = %q", f.RequesterAddress)
	}
	if compactAddress(f.RecipientAddress) != compactAddress("NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF") {
		t.Fatalf("recipient = %q", f.RecipientAddress)
	}
	if f.CreatedAt != 1_700_000_000 || f.UpdatedAt != 1_700_000_000 {
		t.Fatalf("timestamps = %d/%d", f.CreatedAt, f.UpdatedAt)
	}
}

func TestFriendStoreRejectsSelfFriend(t *testing.T) {
	s := newTestFriendStore(t)
	_, err := s.SendRequest(
		"NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD",
		"NQ17VERVF3MQ283TNRSRFPJG55BJPMHCN8MD",
	)
	if !errors.Is(err, errBadRequest) {
		t.Fatalf("got %v, want errBadRequest", err)
	}
}

func TestFriendStoreDuplicatePendingOrAcceptedConflicts(t *testing.T) {
	s := newTestFriendStore(t)
	from := "NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD"
	to := "NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF"

	f, err := s.SendRequest(from, to)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRequest(from, to); !errors.Is(err, errConflict) {
		t.Fatalf("duplicate pending: got %v, want errConflict", err)
	}
	if _, err := s.SendRequest(to, from); !errors.Is(err, errConflict) {
		t.Fatalf("reverse pending: got %v, want errConflict", err)
	}

	if _, err := s.Accept(f.ID, to); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRequest(from, to); !errors.Is(err, errConflict) {
		t.Fatalf("duplicate accepted: got %v, want errConflict", err)
	}
}

func TestFriendStoreRerequestAfterDeclined(t *testing.T) {
	s := newTestFriendStore(t)
	s.now = func() time.Time { return time.Unix(1_700_000_000, 0) }
	from := "NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD"
	to := "NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF"

	f, err := s.SendRequest(from, to)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Decline(f.ID, to); err != nil {
		t.Fatal(err)
	}

	s.now = func() time.Time { return time.Unix(1_700_000_100, 0) }
	again, err := s.SendRequest(from, to)
	if err != nil {
		t.Fatal(err)
	}
	if again.Status != FriendshipPending {
		t.Fatalf("status = %q, want pending", again.Status)
	}
	if again.UpdatedAt != 1_700_000_100 {
		t.Fatalf("updated_at = %d", again.UpdatedAt)
	}
}

func TestFriendStoreAcceptOnlyRecipient(t *testing.T) {
	s := newTestFriendStore(t)
	from := "NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD"
	to := "NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF"
	f, err := s.SendRequest(from, to)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.Accept(f.ID, from); !errors.Is(err, errUnauthorized) {
		t.Fatalf("requester accept: got %v, want errUnauthorized", err)
	}

	accepted, err := s.Accept(f.ID, to)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Status != FriendshipAccepted {
		t.Fatalf("status = %q, want accepted", accepted.Status)
	}
}

func TestFriendStoreDeclineOnlyRecipient(t *testing.T) {
	s := newTestFriendStore(t)
	from := "NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD"
	to := "NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF"
	f, err := s.SendRequest(from, to)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.Decline(f.ID, from); !errors.Is(err, errUnauthorized) {
		t.Fatalf("requester decline: got %v, want errUnauthorized", err)
	}

	declined, err := s.Decline(f.ID, to)
	if err != nil {
		t.Fatal(err)
	}
	if declined.Status != FriendshipDeclined {
		t.Fatalf("status = %q, want declined", declined.Status)
	}
}

func TestFriendStoreRemoveEitherSideDeletesAccepted(t *testing.T) {
	s := newTestFriendStore(t)
	a := "NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD"
	b := "NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF"
	f, err := s.SendRequest(a, b)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Accept(f.ID, b); err != nil {
		t.Fatal(err)
	}

	if err := s.Remove(a, b); err != nil {
		t.Fatal(err)
	}
	friends, err := s.ListFriends(a)
	if err != nil {
		t.Fatal(err)
	}
	if len(friends) != 0 {
		t.Fatalf("expected empty friends after remove, got %v", friends)
	}

	f2, err := s.SendRequest(a, b)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Accept(f2.ID, b); err != nil {
		t.Fatal(err)
	}
	if err := s.Remove(b, a); err != nil {
		t.Fatal(err)
	}
	friends, err = s.ListFriends(b)
	if err != nil {
		t.Fatal(err)
	}
	if len(friends) != 0 {
		t.Fatalf("expected empty friends after reverse remove, got %v", friends)
	}
}

func TestFriendStoreListFriendsAndRequestsScoped(t *testing.T) {
	s := newTestFriendStore(t)
	a := "NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD"
	b := "NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF"
	c := "NQ05 33M2 N93T MB5H CG42 GJFQ 4N4P DY45 YE6N"

	ab, err := s.SendRequest(a, b)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Accept(ab.ID, b); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRequest(a, c); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRequest(c, b); err != nil {
		t.Fatal(err)
	}

	friendsA, err := s.ListFriends(a)
	if err != nil {
		t.Fatal(err)
	}
	if len(friendsA) != 1 || compactAddress(friendsA[0].RecipientAddress) != compactAddress(b) && compactAddress(friendsA[0].RequesterAddress) != compactAddress(b) {
		t.Fatalf("friends A = %+v", friendsA)
	}

	friendsC, err := s.ListFriends(c)
	if err != nil {
		t.Fatal(err)
	}
	if len(friendsC) != 0 {
		t.Fatalf("expected C to have no accepted friends, got %+v", friendsC)
	}

	reqA, err := s.ListRequests(a)
	if err != nil {
		t.Fatal(err)
	}
	if len(reqA) != 1 || compactAddress(reqA[0].RecipientAddress) != compactAddress(c) {
		t.Fatalf("requests A = %+v", reqA)
	}

	reqB, err := s.ListRequests(b)
	if err != nil {
		t.Fatal(err)
	}
	if len(reqB) != 1 || compactAddress(reqB[0].RequesterAddress) != compactAddress(c) {
		t.Fatalf("requests B = %+v", reqB)
	}
}

func TestFriendStorePersistenceRoundTrip(t *testing.T) {
	db := withTestDB(t)
	s := NewFriendStore(db)
	s.now = func() time.Time { return time.Unix(1_700_000_000, 0) }

	f, err := s.SendRequest(
		"NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD",
		"NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF",
	)
	if err != nil {
		t.Fatal(err)
	}

	reloaded := NewFriendStore(db)
	got, err := reloaded.ListRequests("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != f.ID || got[0].Status != FriendshipPending {
		t.Fatalf("reloaded = %+v", got)
	}
}
