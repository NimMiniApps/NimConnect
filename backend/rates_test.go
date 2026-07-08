package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

const sampleCoinGeckoBody = `{
	"nimiq-2": {"eur": 0.0123, "usd": 0.0134, "gbp": 0.0105, "chf": 0.0119, "jpy": 2.01, "cny": 0.0961, "aud": 0.0203, "cad": 0.0182, "inr": 1.11, "brl": 0.0664},
	"bitcoin": {"eur": 58000, "usd": 63000, "gbp": 50000, "chf": 56000, "jpy": 9450000, "cny": 452000, "aud": 95700, "cad": 85700, "inr": 5220000, "brl": 312000},
	"ethereum": {"eur": 3200, "usd": 3500, "gbp": 2800, "chf": 3100, "jpy": 525000, "cny": 25100, "aud": 5290, "cad": 4730, "inr": 290000, "brl": 17300},
	"tether": {"eur": 0.92, "usd": 1.0, "gbp": 0.79, "chf": 0.88, "jpy": 150, "cny": 7.2, "aud": 1.52, "cad": 1.36, "inr": 83.0, "brl": 4.97}
}`

func TestFetchRates_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, sampleCoinGeckoBody)
	}))
	defer server.Close()

	client := &http.Client{}
	resp, err := FetchRates(client, server.URL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp.Source != "CoinGecko" {
		t.Errorf("expected source CoinGecko, got %q", resp.Source)
	}
	if resp.Stale {
		t.Errorf("expected stale=false")
	}
	if resp.Timestamp == "" {
		t.Errorf("expected non-empty timestamp")
	}

	nim, ok := resp.Rates["NIM"]
	if !ok {
		t.Fatalf("missing NIM rates")
	}
	if nim["EUR"] != 0.0123 || nim["USD"] != 0.0134 || nim["GBP"] != 0.0105 || nim["CHF"] != 0.0119 {
		t.Errorf("unexpected NIM rates: %+v", nim)
	}
	if nim["JPY"] != 2.01 || nim["CNY"] != 0.0961 || nim["AUD"] != 0.0203 || nim["CAD"] != 0.0182 || nim["INR"] != 1.11 || nim["BRL"] != 0.0664 {
		t.Errorf("unexpected NIM rates for new currencies: %+v", nim)
	}

	btc, ok := resp.Rates["BTC"]
	if !ok || btc["USD"] != 63000 {
		t.Errorf("unexpected BTC rates: %+v", btc)
	}

	eth, ok := resp.Rates["ETH"]
	if !ok || eth["USD"] != 3500 {
		t.Errorf("unexpected ETH rates: %+v", eth)
	}

	usdt, ok := resp.Rates["USDT"]
	if !ok || usdt["USD"] != 1.0 {
		t.Errorf("unexpected USDT rates: %+v", usdt)
	}
}

func TestFetchRates_MissingAsset(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{
			"nimiq": {"eur": 0.0123, "usd": 0.0134, "gbp": 0.0105, "chf": 0.0119, "jpy": 2.01, "cny": 0.0961, "aud": 0.0203, "cad": 0.0182, "inr": 1.11, "brl": 0.0664}
		}`)
	}))
	defer server.Close()

	client := &http.Client{}
	_, err := FetchRates(client, server.URL)
	if err == nil {
		t.Fatal("expected error for missing asset, got nil")
	}
}

func TestFetchRates_MissingCurrency(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{
			"nimiq-2": {"eur": 0.0123, "usd": 0.0134, "gbp": 0.0105, "chf": 0.0119},
			"bitcoin": {"eur": 58000, "usd": 63000, "gbp": 50000, "chf": 56000},
			"ethereum": {"eur": 3200, "usd": 3500, "gbp": 2800, "chf": 3100},
			"tether": {"eur": 0.92, "usd": 1.0, "gbp": 0.79, "chf": 0.88}
		}`)
	}))
	defer server.Close()

	client := &http.Client{}
	_, err := FetchRates(client, server.URL)
	if err == nil {
		t.Fatal("expected error for missing currency, got nil")
	}
}

func TestFetchRates_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := &http.Client{}
	_, err := FetchRates(client, server.URL)
	if err == nil {
		t.Fatal("expected error for HTTP 500, got nil")
	}
}
