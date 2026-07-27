package main

import (
	"math"
	"testing"
)

func TestParseActivationHeightFailsClosed(t *testing.T) {
	for _, value := range []string{"", "not-a-height", "-1"} {
		if got := parseActivationHeight(value); got != math.MaxUint64 {
			t.Errorf("parseActivationHeight(%q) = %d, want fail-closed %d", value, got, uint64(math.MaxUint64))
		}
	}
	if got := parseActivationHeight("123"); got != 123 {
		t.Errorf("parseActivationHeight valid value = %d, want 123", got)
	}
}
