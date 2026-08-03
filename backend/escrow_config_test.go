package main

import "testing"

func TestRequireEscrowSignerAuthRejectsMissingCredentials(t *testing.T) {
	if _, _, err := requireEscrowSignerAuth("", "pass"); err == nil {
		t.Fatal("expected error when username is empty")
	}
	if _, _, err := requireEscrowSignerAuth("user", ""); err == nil {
		t.Fatal("expected error when password is empty")
	}
	if _, _, err := requireEscrowSignerAuth("  ", "  "); err == nil {
		t.Fatal("expected error when credentials are whitespace")
	}
}

func TestRequireEscrowSignerAuthAcceptsNonEmpty(t *testing.T) {
	user, pass, err := requireEscrowSignerAuth(" escrow-user ", " s3cret ")
	if err != nil {
		t.Fatal(err)
	}
	if user != "escrow-user" || pass != "s3cret" {
		t.Fatalf("got %q/%q", user, pass)
	}
}
