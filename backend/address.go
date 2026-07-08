package main

import (
	"fmt"
	"strings"

	"golang.org/x/crypto/blake2b"
)

const nimiqAlphabet = "0123456789ABCDEFGHJKLMNPQRSTUVXY"

func normalizeAddress(address string) string {
	compact := strings.ToUpper(strings.ReplaceAll(address, " ", ""))
	var b strings.Builder
	for i, r := range compact {
		if i > 0 && i%4 == 0 {
			b.WriteByte(' ')
		}
		b.WriteRune(r)
	}
	return b.String()
}

func compactAddress(address string) string {
	return strings.ToUpper(strings.ReplaceAll(address, " ", ""))
}

func addressFromPublicKey(pubKey []byte) (string, error) {
	if len(pubKey) != 32 {
		return "", fmt.Errorf("invalid public key length")
	}
	hash := blake2b.Sum256(pubKey)
	return userFriendlyAddress(hash[:20])
}

func userFriendlyAddress(addrBytes []byte) (string, error) {
	if len(addrBytes) != 20 {
		return "", fmt.Errorf("invalid address bytes")
	}
	base32 := toBase32(addrBytes)
	check := fmt.Sprintf("%02d", 98-ibanCheck(base32+"NQ00"))
	res := "NQ" + check + base32
	return normalizeAddress(res), nil
}

func ibanCheck(str string) int {
	var num strings.Builder
	for _, c := range strings.ToUpper(str) {
		if c >= '0' && c <= '9' {
			num.WriteRune(c)
		} else {
			num.WriteString(fmt.Sprintf("%d", int(c)-55))
		}
	}
	n := num.String()
	tmp := ""
	for i := 0; i < (len(n)+5)/6; i++ {
		end := (i + 1) * 6
		if end > len(n) {
			end = len(n)
		}
		chunk := tmp + n[i*6:end]
		var rem int
		fmt.Sscanf(chunk, "%d", &rem)
		tmp = fmt.Sprintf("%d", rem%97)
	}
	var out int
	fmt.Sscanf(tmp, "%d", &out)
	return out
}

func toBase32(buf []byte) string {
	alphabet := nimiqAlphabet
	shift := 3
	carry := 0
	var res strings.Builder

	for _, b := range buf {
		symbol := carry | int(b>>shift)
		res.WriteByte(alphabet[symbol&0x1f])

		if shift > 5 {
			shift -= 5
			symbol = int(b >> shift)
			res.WriteByte(alphabet[symbol&0x1f])
		}

		shift = 5 - shift
		carry = int(b) << shift
		shift = 8 - shift
	}

	if shift != 3 {
		res.WriteByte(alphabet[carry&0x1f])
	}

	out := res.String()
	return out
}

func backupChallenge(address string, exportedAt int64) string {
	return fmt.Sprintf("nimconnect-backup:v1:%s:%d", compactAddress(address), exportedAt)
}
