package main

import (
	"fmt"
	"strconv"
	"time"
)

// marketplaceListingMessage is the domain-separated message a seller signs
// to authorize listing an owned handle. Verified with verifySignedMessage
// exactly like profiles.go's profilePutMessage — a wallet message
// signature, never an on-chain transaction signature.
func marketplaceListingMessage(handle, seller string, priceLuna, feeLuna uint64, ownershipEpochTxHash, nonce string, expiresAt int64) string {
	return "nimconnect:marketplace-listing:v1" +
		"\nhandle=" + handle +
		"\nseller=" + compactAddress(seller) +
		"\nprice_luna=" + strconv.FormatUint(priceLuna, 10) +
		"\nfee_luna=" + strconv.FormatUint(feeLuna, 10) +
		"\nownership_epoch_tx_hash=" + ownershipEpochTxHash +
		"\nnonce=" + nonce +
		"\nexpires_at=" + strconv.FormatInt(expiresAt, 10)
}

// marketplacePurchaseMessage is the domain-separated message a buyer signs
// to authorize reserving a listing. It references the listing by handle,
// not by trade ID — the trade doesn't exist yet when the buyer signs this.
func marketplacePurchaseMessage(handle, buyer, refundAddress, nonce string, expiresAt int64) string {
	return "nimconnect:marketplace-purchase:v1" +
		"\nhandle=" + handle +
		"\nbuyer=" + compactAddress(buyer) +
		"\nrefund_address=" + compactAddress(refundAddress) +
		"\nnonce=" + nonce +
		"\nexpires_at=" + strconv.FormatInt(expiresAt, 10)
}

func verifyListingIntent(handle, seller string, priceLuna, feeLuna uint64, ownershipEpochTxHash, nonce string, expiresAt int64, publicKeyHex, signatureHex string) error {
	if time.Now().Unix() > expiresAt {
		return fmt.Errorf("%w: listing intent expired", errBadRequest)
	}
	message := marketplaceListingMessage(handle, seller, priceLuna, feeLuna, ownershipEpochTxHash, nonce, expiresAt)
	if err := verifySignedMessage(seller, publicKeyHex, signatureHex, message); err != nil {
		return fmt.Errorf("%w: %s", errUnauthorized, err)
	}
	return nil
}

func verifyPurchaseIntent(handle, buyer, refundAddress, nonce string, expiresAt int64, publicKeyHex, signatureHex string) error {
	if time.Now().Unix() > expiresAt {
		return fmt.Errorf("%w: purchase intent expired", errBadRequest)
	}
	message := marketplacePurchaseMessage(handle, buyer, refundAddress, nonce, expiresAt)
	if err := verifySignedMessage(buyer, publicKeyHex, signatureHex, message); err != nil {
		return fmt.Errorf("%w: %s", errUnauthorized, err)
	}
	return nil
}

// marketplaceTradesLookupMessage is the domain-separated message a wallet
// signs to prove control of an address before its marketplace trade history
// is returned. Unlike the listing/purchase intents, this is a read-only
// proof of ownership, not an action to authorize — the same signature may
// be reused for repeated lookups (e.g. the trades page polling or
// reloading) until it expires; there is no nonce-consumption/replay
// concern here since nothing is mutated.
func marketplaceTradesLookupMessage(address, nonce string, expiresAt int64) string {
	return "nimconnect:marketplace-trades-lookup:v1" +
		"\naddress=" + compactAddress(address) +
		"\nnonce=" + nonce +
		"\nexpires_at=" + strconv.FormatInt(expiresAt, 10)
}

func verifyTradesLookupIntent(address, nonce string, expiresAt int64, publicKeyHex, signatureHex string) error {
	if time.Now().Unix() > expiresAt {
		return fmt.Errorf("%w: trades lookup intent expired", errBadRequest)
	}
	message := marketplaceTradesLookupMessage(address, nonce, expiresAt)
	if err := verifySignedMessage(address, publicKeyHex, signatureHex, message); err != nil {
		return fmt.Errorf("%w: %s", errUnauthorized, err)
	}
	return nil
}

// marketplaceCancelMessage authorizes canceling an unpaid reservation (SEC-005).
func marketplaceCancelMessage(tradeID, actor, nonce string, expiresAt int64) string {
	return "nimconnect:marketplace-cancel:v1" +
		"\ntrade_id=" + tradeID +
		"\nactor=" + compactAddress(actor) +
		"\nnonce=" + nonce +
		"\nexpires_at=" + strconv.FormatInt(expiresAt, 10)
}

func verifyCancelIntent(tradeID, actor, nonce string, expiresAt int64, publicKeyHex, signatureHex string) error {
	if time.Now().Unix() > expiresAt {
		return fmt.Errorf("%w: cancel intent expired", errBadRequest)
	}
	message := marketplaceCancelMessage(tradeID, actor, nonce, expiresAt)
	if err := verifySignedMessage(actor, publicKeyHex, signatureHex, message); err != nil {
		return fmt.Errorf("%w: %s", errUnauthorized, err)
	}
	return nil
}
