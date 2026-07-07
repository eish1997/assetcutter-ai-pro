-- Auto-expiring promotional credit lots (Phase 1 MVP)

CREATE TABLE IF NOT EXISTS credit_promo_lots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  remaining BIGINT NOT NULL CHECK (remaining >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'depleted', 'expired', 'revoked')),
  idempotency_key TEXT NULL UNIQUE,
  grant_ledger_id TEXT NULL,
  note TEXT NULL,
  created_by TEXT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expired_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_promo_lots_user_status ON credit_promo_lots(user_id, status);
CREATE INDEX IF NOT EXISTS idx_credit_promo_lots_expires ON credit_promo_lots(expires_at) WHERE status = 'active';

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_kind_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_kind_check
  CHECK (kind IN ('grant', 'admin_deduct', 'consume', 'refund', 'promo_grant', 'promo_expire'));
