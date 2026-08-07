-- Catalog-as-registry mirror fields, and app-authenticated achievement awards.
ALTER TABLE auth_apps ADD COLUMN IF NOT EXISTS icon_url TEXT NOT NULL DEFAULT '';
ALTER TABLE auth_apps ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE auth_apps ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';
ALTER TABLE auth_apps ADD COLUMN IF NOT EXISTS api_key_hash BYTEA CHECK (api_key_hash IS NULL OR octet_length(api_key_hash) = 32);

INSERT INTO auth_app_scopes (audience, scope) VALUES
  ('nimconnect', 'achievements:read'),
  ('nimworld', 'achievements:read')
ON CONFLICT (audience, scope) DO NOTHING;

-- rarity and progress are app-declared and untrusted: NimConnect stores and
-- returns them as-is, it does not verify them against any game state.
CREATE TABLE IF NOT EXISTS awards (
  id BIGSERIAL PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES auth_apps(audience),
  achievement_id TEXT NOT NULL,
  address TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rarity TEXT NOT NULL DEFAULT '',
  progress JSONB,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, achievement_id, address)
);
CREATE INDEX IF NOT EXISTS awards_address ON awards (address, granted_at DESC);
