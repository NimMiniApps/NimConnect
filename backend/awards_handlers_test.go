package main

import (
	"crypto/ed25519"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAwardsCreateHandlerRequiresAppCredential(t *testing.T) {
	db := withTestDB(t)
	authStore := NewAuthStore(db)
	awards := NewAwardStore(db)
	if err := authStore.UpsertApp(AppRecord{Audience: "testapp5", DisplayName: "Test App"}); err != nil {
		t.Fatal(err)
	}
	key, err := authStore.IssueAppAPIKey("testapp5")
	if err != nil {
		t.Fatal(err)
	}
	handler := awardsCreateHandler(awards, authStore)
	pub, _, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	body := `{"address":"` + address + `","achievement_id":"first-win","title":"First Win"}`

	noAuth := httptest.NewRecorder()
	handler(noAuth, httptest.NewRequest(http.MethodPost, "/api/awards", strings.NewReader(body)))
	if noAuth.Code != http.StatusUnauthorized {
		t.Fatalf("no credential: got %d, want 401", noAuth.Code)
	}

	ok := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/awards", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+key)
	handler(ok, req)
	if ok.Code != http.StatusOK {
		t.Fatalf("with credential: got %d %s", ok.Code, ok.Body.String())
	}
}

func TestAchievementsListHandlerHidesPrivateFromAnonymousReaders(t *testing.T) {
	db := withTestDB(t)
	authStore := NewAuthStore(db)
	awards := NewAwardStore(db)
	pub, _, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)

	if err := authStore.UpsertApp(AppRecord{
		Audience: "testapp6", DisplayName: "Test App",
		Scopes: []string{ScopeAchievementsRead}, Origins: []string{"https://example.test"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := awards.Grant(Award{AppID: "testapp6", AchievementID: "pub", Address: address, Title: "Public", Visibility: "public"}); err != nil {
		t.Fatal(err)
	}
	if _, err := awards.Grant(Award{AppID: "testapp6", AchievementID: "priv", Address: address, Title: "Private", Visibility: "private"}); err != nil {
		t.Fatal(err)
	}

	handler := achievementsListHandler(awards, authStore)
	req := httptest.NewRequest(http.MethodGet, "/api/profiles/x/achievements", nil)
	req.SetPathValue("address", address)
	rec := httptest.NewRecorder()
	handler(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"pub"`) || strings.Contains(rec.Body.String(), `"priv"`) {
		t.Fatalf("anonymous read: %d %s", rec.Code, rec.Body.String())
	}

	token, _, err := authStore.IssueSession(address, "testapp6", []string{ScopeAchievementsRead})
	if err != nil {
		t.Fatal(err)
	}
	authedReq := httptest.NewRequest(http.MethodGet, "/api/profiles/x/achievements", nil)
	authedReq.SetPathValue("address", address)
	authedReq.Header.Set("Authorization", "Bearer "+token)
	authedRec := httptest.NewRecorder()
	handler(authedRec, authedReq)
	if authedRec.Code != http.StatusOK || !strings.Contains(authedRec.Body.String(), `"priv"`) {
		t.Fatalf("owner read should include private: %d %s", authedRec.Code, authedRec.Body.String())
	}
}
