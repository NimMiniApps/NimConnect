package main

import (
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func escrowSweepServer(t *testing.T, macroHeight *uint64, txs []rpcTx) *httptest.Server {
	t.Helper()
	txsJSON, err := json.Marshal(txs)
	if err != nil {
		t.Fatal(err)
	}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string `json:"method"`
		}
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &req)
		switch req.Method {
		case "getTransactionsByAddress":
			w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":` + string(txsJSON) + `}`))
		case "getLastMacroBlock":
			w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"number":` + strconv.FormatUint(*macroHeight, 10) + `}}`))
		}
	}))
}

func depositTx(hash, sender string, valueLuna uint64, reference string, blockHeight uint64) rpcTx {
	data := hex.EncodeToString([]byte(EscrowReferencePrefix + reference))
	return rpcTx{
		Hash: hash, Sender: sender, Recipient: "NQ99 ESCROW", Data: data,
		Value: valueLuna, BlockNumber: blockHeight,
	}
}

func awaitingDepositTrade(t *testing.T) (*MarketplaceStore, MarketplaceTrade) {
	t.Helper()
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	if _, err := store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1"); err != nil {
		t.Fatal(err)
	}
	trade, err := store.ReserveListing("chuck", "t1", "the-ref", "NQ22 BUYER")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil); err != nil {
		t.Fatal(err)
	}
	return store, trade
}

func TestEscrowWatcher_FundedTradeImmediatelyBecomesAwaitingRelease(t *testing.T) {
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := store.ReserveListing("chuck", "t1", "the-ref", "NQ22 BUYER")
	store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)

	macroHeight := uint64(100)
	srv := escrowSweepServer(t, &macroHeight, []rpcTx{
		depositTx("d1", "NQ22 BUYER", 1000, "the-ref", 50), // block 50, well before macro height 100
	})
	defer srv.Close()

	w := NewEscrowWatcher(NewNimiqRPC(srv.Client(), srv.URL), store, "NQ99 ESCROW")
	if err := w.Sweep(); err != nil {
		t.Fatal(err)
	}

	got, _ := store.Resolve(trade.ID)
	if got.State != StateAwaitingRelease {
		t.Fatalf("expected AWAITING_RELEASE (never observably stuck at FUNDED), got %s", got.State)
	}
}

func TestEscrowWatcher_FundsAMatchingMacroFinalizedDeposit(t *testing.T) {
	store, trade := awaitingDepositTrade(t)
	macroHeight := uint64(100)
	srv := escrowSweepServer(t, &macroHeight, []rpcTx{
		depositTx("d1", "NQ22 BUYER", 1000, "the-ref", 50),
	})
	defer srv.Close()

	w := NewEscrowWatcher(NewNimiqRPC(srv.Client(), srv.URL), store, "NQ99 ESCROW")
	if err := w.Sweep(); err != nil {
		t.Fatal(err)
	}

	got, _ := store.Resolve(trade.ID)
	if got.State != StateAwaitingRelease || got.DepositTxHash != "d1" {
		t.Fatalf("expected AWAITING_RELEASE with deposit hash d1, got %+v", got)
	}
}

func TestEscrowWatcher_StagesUnfinalizedDepositBeforeFunding(t *testing.T) {
	store, trade := awaitingDepositTrade(t)
	macroHeight := uint64(40)
	srv := escrowSweepServer(t, &macroHeight, []rpcTx{
		depositTx("d1", "NQ22 BUYER", 1000, "the-ref", 50),
	})
	defer srv.Close()

	w := NewEscrowWatcher(NewNimiqRPC(srv.Client(), srv.URL), store, "NQ99 ESCROW")
	if err := w.Sweep(); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Resolve(trade.ID)
	if got.State != StateDepositFinalizing || got.DepositTxHash != "d1" || got.DepositBlockHeight != 50 {
		t.Fatalf("expected staged deposit, got %+v", got)
	}

	macroHeight = 50
	w.lastSweep = time.Time{}
	if err := w.Sweep(); err != nil {
		t.Fatal(err)
	}
	got, _ = store.Resolve(trade.ID)
	if got.State != StateAwaitingRelease {
		t.Fatalf("expected staged deposit to become AWAITING_RELEASE, got %+v", got)
	}
}

func TestEscrowWatcher_IgnoresWrongAmountAndWrongPayer(t *testing.T) {
	store, trade := awaitingDepositTrade(t)
	macroHeight := uint64(100)
	srv := escrowSweepServer(t, &macroHeight, []rpcTx{
		depositTx("wrong-amount", "NQ22 BUYER", 500, "the-ref", 10),
		depositTx("wrong-payer", "NQ33 STRANGER", 1000, "the-ref", 10),
	})
	defer srv.Close()

	w := NewEscrowWatcher(NewNimiqRPC(srv.Client(), srv.URL), store, "NQ99 ESCROW")
	if err := w.Sweep(); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Resolve(trade.ID)
	if got.State != StateAwaitingDeposit {
		t.Fatalf("wrong-amount/wrong-payer deposits must not stage the trade, got %s", got.State)
	}
}

func TestEscrowWatcher_IgnoresUnattributableReference(t *testing.T) {
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	macroHeight := uint64(100)
	srv := escrowSweepServer(t, &macroHeight, []rpcTx{
		depositTx("d1", "NQ22 BUYER", 1000, "no-such-trade", 10),
	})
	defer srv.Close()

	w := NewEscrowWatcher(NewNimiqRPC(srv.Client(), srv.URL), store, "NQ99 ESCROW")
	if err := w.Sweep(); err != nil {
		t.Fatal(err)
	}
}

func TestBuildAndParseTradeReference_RoundTrips(t *testing.T) {
	ref := buildTradeReference()
	if len(ref) == 0 {
		t.Fatal("expected a non-empty reference")
	}
	dataHex := hex.EncodeToString([]byte(EscrowReferencePrefix + ref))
	if got := parseTradeReference(dataHex); got != ref {
		t.Fatalf("expected round-trip reference %q, got %q", ref, got)
	}
}
