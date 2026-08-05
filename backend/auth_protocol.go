package main

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	ScopeFriendsRead      = "friends:read"
	ScopeFriendsWrite     = "friends:write"
	ScopeInboxRead        = "inbox:read"
	ScopeInboxSend        = "inbox:send"
	ScopeInboxDelete      = "inbox:delete"
	ScopeProfileWrite     = "profile:write"
	ScopeBackupRead       = "backup:read"
	ScopeBackupWrite      = "backup:write"
	ScopeMarketplaceRead  = "marketplace:read"
	ScopeMarketplaceTrade = "marketplace:trade"
)

var authorizationScopes = map[string]struct{}{
	ScopeFriendsRead: {}, ScopeFriendsWrite: {}, ScopeInboxRead: {}, ScopeInboxSend: {},
	ScopeInboxDelete: {}, ScopeProfileWrite: {}, ScopeBackupRead: {}, ScopeBackupWrite: {},
	ScopeMarketplaceRead: {}, ScopeMarketplaceTrade: {},
}

var authorizationAudienceRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,31}$`)

func validateAuthorizationScopes(scopes []string) ([]string, error) {
	if len(scopes) == 0 {
		return nil, errors.New("at least one authorization scope is required")
	}
	seen := make(map[string]struct{}, len(scopes))
	canonical := append([]string(nil), scopes...)
	for _, scope := range canonical {
		if _, ok := authorizationScopes[scope]; !ok {
			return nil, fmt.Errorf("unknown authorization scope %q", scope)
		}
		if _, ok := seen[scope]; ok {
			return nil, fmt.Errorf("duplicate authorization scope %q", scope)
		}
		seen[scope] = struct{}{}
	}
	sort.Strings(canonical)
	return canonical, nil
}

func buildAuthorizationMessage(address, audience string, scopes []string, expiresAt time.Time, nonce string) (string, []string, error) {
	if !authorizationAudienceRe.MatchString(audience) {
		return "", nil, errors.New("invalid authorization audience")
	}
	canonical, err := validateAuthorizationScopes(scopes)
	if err != nil {
		return "", nil, err
	}
	if nonce == "" {
		return "", nil, errors.New("authorization nonce is required")
	}
	message := "NimConnect authorization v3" +
		"\nApp: " + audience +
		"\nAddress: " + compactAddress(address) +
		"\nAccess: " + strings.Join(canonical, ", ") +
		"\nExpires: " + expiresAt.UTC().Truncate(time.Second).Format(time.RFC3339) +
		"\nNonce: " + nonce
	return message, canonical, nil
}
