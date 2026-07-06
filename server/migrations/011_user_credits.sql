-- Unified credits: manual grant + consume (v1)

CREATE TABLE IF NOT EXISTS user_credit_balances (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_granted BIGINT NOT NULL DEFAULT 0,
  lifetime_spent BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'admin_deduct', 'consume', 'refund')),
  ref_type TEXT NULL,
  ref_id TEXT NULL,
  idempotency_key TEXT NULL UNIQUE,
  note TEXT NULL,
  created_by TEXT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created ON credit_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_ref ON credit_ledger(ref_type, ref_id) WHERE ref_id IS NOT NULL;

ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS credits_charged BIGINT NULL;
