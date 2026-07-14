package main

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"regexp"
	"strings"
)

// On-chain claim payload: plain text "NCC:v1:<verb>:<handle>" sent as tx data
// to the registry address. Text (not binary) so it's readable in explorers and
// parseable by any indexer. Longest form ("NCC:v1:release:" + 26-char handle)
// is 41 chars — inside Nimiq Pay's 64-char text transaction limit.
const claimPrefix = "NCC:v1:"

var handleRe = regexp.MustCompile(`^[a-z0-9_]{3,26}$`)

func isValidHandle(h string) bool { return handleRe.MatchString(h) }

type claimAction struct {
	Verb   string // "claim" | "release"
	Handle string
}

func makeClaimPayload(verb, handle string) string {
	return claimPrefix + verb + ":" + handle
}

// parseClaimData decodes hex-encoded tx data into a claim action.
// Returns nil for anything that isn't a valid NimConnect claim — including
// unknown verbs, so future types (transfer, verify, …) don't break old indexers.
func parseClaimData(dataHex string) *claimAction {
	raw, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(dataHex), "0x"))
	if err != nil {
		return nil
	}
	text := string(raw)
	if !strings.HasPrefix(text, claimPrefix) {
		return nil
	}
	verb, handle, ok := strings.Cut(strings.TrimPrefix(text, claimPrefix), ":")
	if !ok || (verb != "claim" && verb != "release") || !isValidHandle(handle) {
		return nil
	}
	return &claimAction{Verb: verb, Handle: handle}
}

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
