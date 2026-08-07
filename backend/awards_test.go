package main

import (
	"crypto/ed25519"
	"testing"
)

func TestAwardGrantIsIdempotent(t *testing.T) {
	db := withTestDB(t)
	authStore := NewAuthStore(db)
	awards := NewAwardStore(db)
	pub, _, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)

	if err := authStore.UpsertApp(AppRecord{Audience: "testapp3", DisplayName: "Test App"}); err != nil {
		t.Fatal(err)
	}

	first, err := awards.Grant(Award{AppID: "testapp3", AchievementID: "first-win", Address: address, Title: "First Win"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := awards.Grant(Award{AppID: "testapp3", AchievementID: "first-win", Address: address, Title: "First Win (retry, different title)"})
	if err != nil {
		t.Fatal(err)
	}
	if second.Title != first.Title {
		t.Fatalf("retry must not overwrite: first=%q second=%q", first.Title, second.Title)
	}

	list, err := awards.ListForAddress(address, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("expected exactly one stored award despite retry, got %d", len(list))
	}
}

func TestAwardVisibilityHidesPrivateFromPublicReads(t *testing.T) {
	db := withTestDB(t)
	authStore := NewAuthStore(db)
	awards := NewAwardStore(db)
	pub, _, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)

	if err := authStore.UpsertApp(AppRecord{Audience: "testapp4", DisplayName: "Test App"}); err != nil {
		t.Fatal(err)
	}
	if _, err := awards.Grant(Award{AppID: "testapp4", AchievementID: "public-one", Address: address, Title: "Public", Visibility: "public"}); err != nil {
		t.Fatal(err)
	}
	if _, err := awards.Grant(Award{AppID: "testapp4", AchievementID: "secret-one", Address: address, Title: "Secret", Visibility: "private"}); err != nil {
		t.Fatal(err)
	}

	publicOnly, err := awards.ListForAddress(address, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(publicOnly) != 1 || publicOnly[0].AchievementID != "public-one" {
		t.Fatalf("public read leaked private award: %+v", publicOnly)
	}

	all, err := awards.ListForAddress(address, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("owner read should see both, got %+v", all)
	}
}
