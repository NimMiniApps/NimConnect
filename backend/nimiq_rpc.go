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
	BlockNumber      uint64 `json:"blockNumber"`
	TransactionIndex uint64 `json:"transactionIndex"`
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
	// PoS gateways wrap results as {"data": ...}; unwrap only when that's the sole key.
	var probe map[string]json.RawMessage
	if json.Unmarshal(envelope.Result, &probe) == nil {
		if data, ok := probe["data"]; ok && len(probe) == 1 {
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
