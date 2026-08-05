ALTER TABLE profiles
  ALTER COLUMN public_key DROP NOT NULL,
  ALTER COLUMN signature DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'wallet_signature',
  ADD COLUMN IF NOT EXISTS auth_session_id TEXT,
  ADD COLUMN IF NOT EXISTS auth_audience TEXT,
  ADD CONSTRAINT profiles_auth_mode_check CHECK (auth_mode IN ('wallet_signature', 'scoped_session'));

ALTER TABLE inbox_messages
  ALTER COLUMN public_key DROP NOT NULL,
  ALTER COLUMN signature DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'wallet_signature',
  ADD COLUMN IF NOT EXISTS auth_session_id TEXT,
  ADD COLUMN IF NOT EXISTS auth_audience TEXT,
  ADD CONSTRAINT inbox_messages_auth_mode_check CHECK (auth_mode IN ('wallet_signature', 'scoped_session'));
