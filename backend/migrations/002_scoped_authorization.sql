CREATE TABLE IF NOT EXISTS auth_apps (
  audience TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS auth_app_origins (
  audience TEXT NOT NULL REFERENCES auth_apps(audience) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  PRIMARY KEY (audience, origin)
);

CREATE TABLE IF NOT EXISTS auth_app_scopes (
  audience TEXT NOT NULL REFERENCES auth_apps(audience) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  PRIMARY KEY (audience, scope)
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  nonce_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(nonce_hash) = 32),
  address TEXT NOT NULL,
  audience TEXT NOT NULL REFERENCES auth_apps(audience),
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
CREATE INDEX IF NOT EXISTS auth_challenges_address_created
  ON auth_challenges (address, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_challenges_expires_at
  ON auth_challenges (expires_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash BYTEA PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  address TEXT NOT NULL,
  audience TEXT NOT NULL REFERENCES auth_apps(audience),
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days'),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX IF NOT EXISTS auth_sessions_address
  ON auth_sessions (address);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at
  ON auth_sessions (expires_at);

INSERT INTO auth_apps (audience, display_name, enabled) VALUES
  ('nimconnect', 'NimConnect', true),
  ('nimworld', 'NimWorld', true)
ON CONFLICT (audience) DO NOTHING;

INSERT INTO auth_app_origins (audience, origin) VALUES
  ('nimconnect', 'https://nimconnect.nimiqminiapps.com'),
  ('nimconnect', 'http://localhost:5173'),
  ('nimworld', 'https://nimworld.nimiqminiapps.com'),
  ('nimworld', 'http://localhost:5175')
ON CONFLICT (audience, origin) DO NOTHING;

INSERT INTO auth_app_scopes (audience, scope) VALUES
  ('nimconnect', 'friends:read'),
  ('nimconnect', 'friends:write'),
  ('nimconnect', 'inbox:read'),
  ('nimconnect', 'inbox:send'),
  ('nimconnect', 'inbox:delete'),
  ('nimconnect', 'profile:write'),
  ('nimconnect', 'backup:read'),
  ('nimconnect', 'backup:write'),
  ('nimconnect', 'marketplace:read'),
  ('nimconnect', 'marketplace:trade'),
  ('nimworld', 'friends:read'),
  ('nimworld', 'friends:write')
ON CONFLICT (audience, scope) DO NOTHING;
