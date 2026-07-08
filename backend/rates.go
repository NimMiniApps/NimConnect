package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// AssetRates holds an asset's price in each supported fiat currency, keyed by
// uppercase ISO 4217 currency code (e.g. "EUR", "USD").
type AssetRates map[string]float64

// RatesResponse is the normalized payload returned by GET /api/rates.
type RatesResponse struct {
	Rates     map[string]AssetRates `json:"rates"`
	Timestamp string                `json:"timestamp"`
	FetchedAt string                `json:"fetched_at"`
	Stale     bool                  `json:"stale"`
	Source    string                `json:"source"`
}

var coinGeckoIDToAsset = map[string]string{
	"nimiq-2":  "NIM", // CoinGecko API ID for Nimiq (NIM); "nimiq" is a stale/wrong entry
	"bitcoin":  "BTC",
	"ethereum": "ETH",
	"tether":   "USDT",
}

// SupportedFiatCurrencies lists the fiat currencies (as CoinGecko's lowercase
// vs_currency codes) returned for every asset, covering the most commonly
// used currency in each major region.
var SupportedFiatCurrencies = []string{
	"eur", // Europe
	"usd", // United States
	"gbp", // United Kingdom
	"chf", // Switzerland
	"jpy", // Japan
	"cny", // China
	"aud", // Australia
	"cad", // Canada
	"inr", // India
	"brl", // Brazil
}

// FetchRates fetches NIM, BTC, ETH, and USDT prices in all SupportedFiatCurrencies
// from CoinGecko's simple price endpoint and normalizes them into a RatesResponse.
func FetchRates(client *http.Client, baseURL string) (RatesResponse, error) {
	url := fmt.Sprintf(
		"%s/simple/price?ids=nimiq-2,bitcoin,ethereum,tether&vs_currencies=%s",
		baseURL, strings.Join(SupportedFiatCurrencies, ","),
	)

	resp, err := client.Get(url)
	if err != nil {
		return RatesResponse{}, fmt.Errorf("fetching rates: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return RatesResponse{}, fmt.Errorf("coingecko returned status %d", resp.StatusCode)
	}

	var raw map[string]map[string]float64
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return RatesResponse{}, fmt.Errorf("decoding rates: %w", err)
	}

	rates := make(map[string]AssetRates, len(coinGeckoIDToAsset))
	for id, asset := range coinGeckoIDToAsset {
		prices, ok := raw[id]
		if !ok {
			return RatesResponse{}, fmt.Errorf("missing price for %s", id)
		}

		assetRates := make(AssetRates, len(SupportedFiatCurrencies))
		for _, currency := range SupportedFiatCurrencies {
			price, ok := prices[currency]
			if !ok {
				return RatesResponse{}, fmt.Errorf("missing %s price for %s", currency, id)
			}
			assetRates[strings.ToUpper(currency)] = price
		}
		rates[asset] = assetRates
	}

	now := time.Now().UTC().Format(time.RFC3339)
	return RatesResponse{
		Rates:     rates,
		Timestamp: now,
		FetchedAt: now,
		Stale:     false,
		Source:    "CoinGecko",
	}, nil
}
