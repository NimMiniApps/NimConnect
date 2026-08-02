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
	url         string
	client      *http.Client
	id          atomic.Int64
	rpcUser     string
	rpcPassword string
}

func NewNimiqRPC(client *http.Client, url string) *NimiqRPC {
	return &NimiqRPC{url: url, client: client}
}

// WithBasicAuth scopes RPC credentials to this client only — reserved for
// the escrow-signer node, which has the escrow wallet unlocked and must
// never be reachable without authentication (an unauthenticated unlocked
// node lets anyone who can reach it drain the escrow account).
func (c *NimiqRPC) WithBasicAuth(user, password string) *NimiqRPC {
	c.rpcUser = user
	c.rpcPassword = password
	return c
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
	Timestamp        int64  `json:"timestamp"`
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
	req, err := http.NewRequest(http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.rpcUser != "" {
		req.SetBasicAuth(c.rpcUser, c.rpcPassword)
	}
	resp, err := c.client.Do(req)
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

// GetBalance is a read-only lookup usable against the public gateway (unlike
// the wallet-management methods below, which only make sense against our
// own escrow-signer node).
func (c *NimiqRPC) GetBalance(address string) (uint64, error) {
	var account struct {
		Balance uint64 `json:"balance"`
	}
	if err := c.call("getAccountByAddress", []any{address}, &account); err != nil {
		return 0, err
	}
	return account.Balance, nil
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

// The methods below manage a node's local wallet (import/unlock/list) —
// public gateways don't expose them, they only make sense against our own
// escrow-signer node.

func (c *NimiqRPC) IsConsensusEstablished() (bool, error) {
	var established bool
	if err := c.call("isConsensusEstablished", []any{}, &established); err != nil {
		return false, err
	}
	return established, nil
}

// ImportRawKey loads a private key into the node's wallet and returns the
// resulting address. It does not unlock the account.
func (c *NimiqRPC) ImportRawKey(keyHex, passphrase string) (string, error) {
	var address string
	if err := c.call("importRawKey", []any{keyHex, passphrase}, &address); err != nil {
		return "", err
	}
	return address, nil
}

func (c *NimiqRPC) ListAccounts() ([]string, error) {
	var accounts []string
	if err := c.call("listAccounts", []any{}, &accounts); err != nil {
		return nil, err
	}
	return accounts, nil
}

func (c *NimiqRPC) IsAccountUnlocked(address string) (bool, error) {
	var unlocked bool
	if err := c.call("isAccountUnlocked", []any{address}, &unlocked); err != nil {
		return false, err
	}
	return unlocked, nil
}

// UnlockAccount unlocks address for signing. duration is in milliseconds;
// 0 means unlock indefinitely (until the node restarts).
func (c *NimiqRPC) UnlockAccount(address, passphrase string, duration uint64) error {
	var ok bool
	if err := c.call("unlockAccount", []any{address, passphrase, duration}, &ok); err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("unlockAccount returned false for %s", address)
	}
	return nil
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
