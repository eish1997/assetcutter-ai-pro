-- Credit reserve (hold) for concurrent gate / proxy admission

ALTER TABLE user_credit_balances ADD COLUMN IF NOT EXISTS reserved BIGINT NOT NULL DEFAULT 0 CHECK (reserved >= 0);

CREATE TABLE IF NOT EXISTS credit_reserves (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'finalized', 'released')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_reserves_user_status ON credit_reserves(user_id, status);
CREATE INDEX IF NOT EXISTS idx_credit_reserves_expires ON credit_reserves(expires_at) WHERE status = 'active';
