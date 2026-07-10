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

func isInboxNonce(s string) bool { return nonceRe.MatchString(s) }
func isMessageID(s string) bool  { return messageIDRe.MatchString(s) }

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
