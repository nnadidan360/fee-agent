CREATE INDEX IF NOT EXISTS idx_nonces_expires_at ON nonces (expires_at);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON revoked_tokens (expires_at);
