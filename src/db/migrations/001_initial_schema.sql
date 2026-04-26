CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS nonces (
  nonce          TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        TEXT PRIMARY KEY,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_wallet TEXT NOT NULL,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'paused', 'triggered')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_creator_wallet ON agents (creator_wallet);

CREATE TABLE IF NOT EXISTS rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  condition_type  TEXT NOT NULL CHECK (condition_type IN ('threshold', 'time', 'referral')),
  condition_value TEXT NOT NULL,
  action_type     TEXT NOT NULL CHECK (action_type IN ('split', 'convert', 'reinvest')),
  action_config   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rules_agent_id ON rules (agent_id);

CREATE TABLE IF NOT EXISTS transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id),
  rule_id     UUID NOT NULL REFERENCES rules(id),
  action_type TEXT NOT NULL CHECK (action_type IN ('split', 'convert', 'reinvest')),
  amount_sol  NUMERIC(18, 9) NOT NULL,
  tx_hash     TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_agent_id_executed_at ON transactions (agent_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key        TEXT PRIMARY KEY,
  status     TEXT NOT NULL CHECK (status IN ('pending', 'executed', 'failed')),
  tx_hash    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
