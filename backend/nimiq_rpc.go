package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
)

// NimiqRPC is a minimal JSON-RPC client for a Nimiq PoS node / public gateway.
// ponytail: positional params only; add the object-param calling convention
// if a target node ever rejects positional (NimFeed supports both).
type NimiqRPC struct {
	url    string
	client *http.Client
	id     atomic.Int64
}

func NewNimiqRPC(client *http.Client, url string) *NimiqRPC {
	return &NimiqRPC{url: url, client: client}
}

// rpcTx tolerates the field-name variants different node versions emit
// (from/to vs sender/recipient, data vs recipientData) — same normalization
// NimFeed applies.
type rpcTx struct {
	Hash             string `json:"hash"`
	Sender           string `json:"sender"`
	From             string `json:"from"`
	Recipient        string `json:"recipient"`
	To               string `json:"to"`
	Data             string `json:"data"`
	RecipientData    string `json:"recipientData"`
	Value            uint64 `json:"value"`
	BlockNumber      uint64 `json:"blockNumber"`
	TransactionIndex uint64 `json:"transactionIndex"`
	// Account types: 0 basic, 1 vesting, 2 HTLC contract. Nimiq Pay routes
	// payments through swap HTLCs, so claim txs arrive with FromType 2.
	FromType int `json:"fromType"`
	ToType   int `json:"toType"`
}

func (t rpcTx) sender() string {
	if t.Sender != "" {
		return t.Sender
	}
	return t.From
}

func (t rpcTx) recipient() string {
	if t.Recipient != "" {
		return t.Recipient
	}
	return t.To
}

func (t rpcTx) data() string {
	if t.Data != "" {
		return t.Data
	}
	return t.RecipientData
}

func (c *NimiqRPC) call(method string, params []any, out any) error {
	body, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "id": c.id.Add(1), "method": method, "params": params,
	})
	if err != nil {
		return err
	}
	resp, err := c.client.Post(c.url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return err
	}
	if envelope.Error != nil {
		return fmt.Errorf("rpc %s: %s", method, envelope.Error.Message)
	}
	// PoS gateways wrap payloads as {"data": ..., "metadata": ...} — unwrap data
	// whenever present (metadata is ignored).
	var probe map[string]json.RawMessage
	if json.Unmarshal(envelope.Result, &probe) == nil {
		// A transaction itself also has a data field. Only unwrap the PoS
		// gateway envelope, which includes metadata alongside its data payload.
		if data, ok := probe["data"]; ok && probe["metadata"] != nil {
			return json.Unmarshal(data, out)
		}
	}
	return json.Unmarshal(envelope.Result, out)
}

func (c *NimiqRPC) GetTransactionsByAddress(address string, max int) ([]rpcTx, error) {
	var txs []rpcTx
	if err := c.call("getTransactionsByAddress", []any{address, max, nil}, &txs); err != nil {
		return nil, err
	}
	return txs, nil
}

func (c *NimiqRPC) GetTransactionByHash(hash string) (*rpcTx, error) {
	var tx rpcTx
	if err := c.call("getTransactionByHash", []any{hash}, &tx); err != nil {
		return nil, err
	}
	return &tx, nil
}

// GetLastMacroBlockNumber returns the most recently macro-finalized block
// height. Transactions at or below this height are final.
func (c *NimiqRPC) GetLastMacroBlockNumber() (uint64, error) {
	var block struct {
		Number uint64 `json:"number"`
	}
	if err := c.call("getLastMacroBlock", []any{}, &block); err != nil {
		return 0, err
	}
	return block.Number, nil
}

// GetBlockNumber returns the current chain tip height. Used to give clients
// a fresh validityStartHeight for wallet-signed transactions (e.g. Hub's
// signTransaction, which requires one explicitly).
func (c *NimiqRPC) GetBlockNumber() (uint64, error) {
	var height uint64
	if err := c.call("getBlockNumber", []any{}, &height); err != nil {
		return 0, err
	}
	return height, nil
}

// SendBasicTransactionWithData asks the connected node to sign and broadcast
// a transaction from sender. It must only be used with the dedicated,
// access-restricted escrow signing node which has that key unlocked.
func (c *NimiqRPC) SendBasicTransactionWithData(sender, recipient string, valueLuna uint64, dataHex string) (string, error) {
	var hash string
	if err := c.call("sendBasicTransactionWithData", []any{sender, recipient, dataHex, valueLuna, 0, nil}, &hash); err != nil {
		return "", err
	}
	return hash, nil
}

// SendRawTransaction broadcasts an already-signed, serialized transaction.
// It is used for the Hub choreography path, where the wallet signs but does
// not broadcast.
func (c *NimiqRPC) SendRawTransaction(rawHex string) (string, error) {
	var hash string
	if err := c.call("sendRawTransaction", []any{rawHex}, &hash); err != nil {
		return "", err
	}
	return hash, nil
}
