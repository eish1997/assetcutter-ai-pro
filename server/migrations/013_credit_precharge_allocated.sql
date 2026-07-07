-- 预扣费（先扣 balance）池：已分配用量 allocated，剩余可退
ALTER TABLE credit_reserves ADD COLUMN IF NOT EXISTS allocated BIGINT NOT NULL DEFAULT 0;
ALTER TABLE credit_reserves DROP CONSTRAINT IF EXISTS credit_reserves_status_check;
ALTER TABLE credit_reserves ADD CONSTRAINT credit_reserves_status_check
  CHECK (status IN ('active', 'precharged', 'finalized', 'released'));
