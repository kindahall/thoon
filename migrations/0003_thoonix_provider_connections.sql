CREATE TABLE IF NOT EXISTS thoonix_provider_connections (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  label text NOT NULL,
  provider_type text NOT NULL CHECK (provider_type IN ('codex-bridge', 'openai', 'openai-compatible')),
  auth_type text NOT NULL CHECK (auth_type IN ('api_key', 'codex_oauth_bridge')),
  endpoint text NOT NULL DEFAULT 'responses' CHECK (endpoint IN ('responses', 'chat-completions')),
  base_url text,
  model text NOT NULL,
  chat_model text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error', 'pending_bridge')),
  is_default boolean NOT NULL DEFAULT true,
  masked_credential text,
  encrypted_credential jsonb,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS thoonix_provider_connections_workspace_idx
  ON thoonix_provider_connections (workspace_id, is_default DESC, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS thoonix_provider_connections_one_default_idx
  ON thoonix_provider_connections (workspace_id)
  WHERE is_default IS TRUE AND status <> 'disabled';

CREATE TABLE IF NOT EXISTS thoonix_bridge_pairing_codes (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  code_hash text NOT NULL UNIQUE,
  code_hint text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS thoonix_bridge_pairing_codes_workspace_idx
  ON thoonix_bridge_pairing_codes (workspace_id, status, expires_at DESC);
