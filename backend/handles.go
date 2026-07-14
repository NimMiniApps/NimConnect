package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"regexp"
	"strings"
)

// NimConnect shares the NimFeed on-chain username registry: a claim is a
// PROFILE_CLAIM transaction to the NimFeed catalog address, so @chuck is one
// identity across both apps. Payload encodings:
//
//	raw binary (Nimiq Hub):    "NF" 0x01 0x01 <username> [0x00 <display name>]
//	text envelope (Nimiq Pay): "NFH:" + hex of the binary payload
//
// Earliest claim per (block, txIndex) wins. The protocol has no release type —
// claims are permanent until the NimFeed protocol grows one.
var claimMagic = []byte{0x4e, 0x46} // "NF"

const (
	claimVersion     = 0x01
	claimTypeProfile = 0x01
	claimTextPrefix  = "NFH:"
)

// Username rules mirror NimFeed's normalizeUsername (3–31 chars, [a-z0-9_]).
// Claims sent from inside Nimiq Pay are limited to 26 chars by the 64-char
// text-transaction cap; longer names claim via Hub / NimFeed in a browser.
var handleRe = regexp.MustCompile(`^[a-z0-9_]{3,31}$`)

func isValidHandle(h string) bool { return handleRe.MatchString(h) }

type claimAction struct {
	Handle string
}

// makeClaimPayload builds the Nimiq Pay text envelope for a username-only
// claim (display names live in the off-chain profile, not on chain).
func makeClaimPayload(handle string) string {
	payload := append(append([]byte{}, claimMagic...), claimVersion, claimTypeProfile)
	payload = append(payload, []byte(handle)...)
	return claimTextPrefix + hex.EncodeToString(payload)
}

// parseClaimPayload decodes a binary PROFILE_CLAIM payload.
func parseClaimPayload(payload []byte) *claimAction {
	if len(payload) < 4 || !bytes.HasPrefix(payload, claimMagic) ||
		payload[2] != claimVersion || payload[3] != claimTypeProfile {
		return nil
	}
	rest := payload[4:]
	// Username runs to the 0x00 separator (display name follows) or payload end.
	if i := bytes.IndexByte(rest, 0); i >= 0 {
		rest = rest[:i]
	}
	handle := string(rest)
	if !isValidHandle(handle) {
		return nil
	}
	return &claimAction{Handle: handle}
}

// parseClaimData decodes hex tx data into a claim, accepting both the raw
// binary form (Hub) and the "NFH:" text envelope (Nimiq Pay). Returns nil for
// anything else — posts, follows, and future NimFeed types don't break us.
func parseClaimData(dataHex string) *claimAction {
	raw, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(dataHex), "0x"))
	if err != nil {
		return nil
	}
	if text := string(raw); strings.HasPrefix(text, claimTextPrefix) {
		inner, err := hex.DecodeString(strings.TrimSpace(strings.TrimPrefix(text, claimTextPrefix)))
		if err != nil {
			return nil
		}
		return parseClaimPayload(inner)
	}
	return parseClaimPayload(raw)
}

// builtinReserved blocks claiming through NimConnect's UI only. Resolution
// always follows the chain — a reserved name claimed via NimFeed still
// resolves here, otherwise the shared namespace would fork between apps.
var builtinReserved = []string{
	"nimiq", "nimconnect", "nimpay", "nimfeed", "admin", "administrator",
	"support", "help", "official", "team", "security", "wallet", "pay", "root",
}

// loadReservedHandles reads a JSON string array; a valid non-empty file
// replaces the builtin set entirely. Entries are lowercased.
func loadReservedHandles(path string) map[string]bool {
	list := builtinReserved
	if data, err := readFileIfExists(path); err == nil && data != nil {
		var fromFile []string
		if json.Unmarshal(data, &fromFile) == nil && len(fromFile) > 0 {
			list = fromFile
		}
	}
	set := make(map[string]bool, len(list))
	for _, h := range list {
		set[strings.ToLower(h)] = true
	}
	return set
}

// readFileIfExists returns (nil, nil) for a missing file, contents otherwise.
func readFileIfExists(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	return data, err
}
