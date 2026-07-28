package main

// SubmitHubTransaction broadcasts a client-signed, not-yet-sent raw
// transaction (Hub's signTransaction flow), then looks the result back up
// on chain and runs verify against what the node actually recorded.
func SubmitHubTransaction(rpc *NimiqRPC, rawHex string, verify func(rpcTx) error) (string, error) {
	hash, err := rpc.SendRawTransaction(rawHex)
	if err != nil {
		return "", err
	}
	tx, err := rpc.GetTransactionByHash(hash)
	if err != nil {
		return "", err
	}
	if err := verify(*tx); err != nil {
		return "", err
	}
	return hash, nil
}

// SubmitPayTransaction handles the Nimiq Pay flow, where the wallet signs
// and sends in one step. The reported hash is only a lookup key: verify runs
// against the chain's own transaction record.
func SubmitPayTransaction(rpc *NimiqRPC, txHash string, verify func(rpcTx) error) error {
	tx, err := rpc.GetTransactionByHash(txHash)
	if err != nil {
		return err
	}
	return verify(*tx)
}
