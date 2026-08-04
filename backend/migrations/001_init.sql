CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_listings (
  handle TEXT PRIMARY KEY,
  seller TEXT NOT NULL,
  price_luna BIGINT NOT NULL CHECK (price_luna >= 0),
  fee_luna BIGINT NOT NULL CHECK (fee_luna >= 0),
  status TEXT NOT NULL,
  ownership_epoch_tx_hash TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listings_one_active
  ON marketplace_listings (handle) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS marketplace_trades (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  buyer TEXT NOT NULL,
  seller TEXT NOT NULL,
  price_luna BIGINT NOT NULL,
  fee_luna BIGINT NOT NULL,
  escrow_address TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  deposit_tx_hash TEXT NOT NULL DEFAULT '',
  deposit_block_height BIGINT NOT NULL DEFAULT 0,
  release_tx_hash TEXT NOT NULL DEFAULT '',
  claim_tx_hash TEXT NOT NULL DEFAULT '',
  payout_attempted_at BIGINT NOT NULL DEFAULT 0,
  payout_tx_hash TEXT NOT NULL DEFAULT '',
  refund_attempted_at BIGINT NOT NULL DEFAULT 0,
  refund_tx_hash TEXT NOT NULL DEFAULT '',
  deposit_deadline BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS marketplace_trades_handle_state ON marketplace_trades (handle, state);
CREATE INDEX IF NOT EXISTS marketplace_trades_buyer ON marketplace_trades (buyer);
CREATE INDEX IF NOT EXISTS marketplace_trades_seller ON marketplace_trades (seller);

CREATE TABLE IF NOT EXISTS marketplace_nonces (
  nonce TEXT PRIMARY KEY,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS escrow_ledger (
  sequence BIGSERIAL PRIMARY KEY,
  trade_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_luna BIGINT NOT NULL,
  tx_hash TEXT NOT NULL DEFAULT '',
  timestamp BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  address TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  public_key TEXT NOT NULL,
  signature TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stats_days (
  day DATE PRIMARY KEY,
  opens INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stats_day_wallets (
  day DATE NOT NULL REFERENCES stats_days(day) ON DELETE CASCADE,
  address TEXT NOT NULL,
  PRIMARY KEY (day, address)
);

CREATE TABLE IF NOT EXISTS inbox_messages (
  id TEXT PRIMARY KEY,
  version INT NOT NULL,
  type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  payload TEXT NOT NULL,
  sent_at BIGINT NOT NULL,
  received_at BIGINT NOT NULL,
  public_key TEXT NOT NULL,
  signature TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inbox_messages_recipient ON inbox_messages (recipient);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_messages_sender_nonce ON inbox_messages (sender, nonce);

CREATE TABLE IF NOT EXISTS handle_claims (
  handle TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_height BIGINT NOT NULL,
  tx_index BIGINT NOT NULL,
  claimed_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS handle_claims_address ON handle_claims (address);

CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  requester_address TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_active
  ON friendships (
    LEAST(requester_address, recipient_address),
    GREATEST(requester_address, recipient_address)
  ) WHERE status IN ('pending', 'accepted');
