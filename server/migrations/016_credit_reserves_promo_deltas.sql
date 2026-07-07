-- Precharge 时锁定的活动积分桶分配（JSON: [{ lotId, amount }]，退款时还原）

ALTER TABLE credit_reserves ADD COLUMN IF NOT EXISTS promo_lot_deltas TEXT NULL;
