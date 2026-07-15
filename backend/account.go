package main

// chainAccount is the subset of getAccountByAddress we need for HTLC owner lookup.
type chainAccount struct {
	Address string `json:"address"`
	Type    string `json:"type"`
	Sender  string `json:"sender"`
}

func (c *NimiqRPC) GetAccountByAddress(address string) (*chainAccount, error) {
	var acc chainAccount
	if err := c.call("getAccountByAddress", []any{address}, &acc); err != nil {
		return nil, err
	}
	return &acc, nil
}
