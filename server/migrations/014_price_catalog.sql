-- B4: versioned price_catalog runtime store + usage_events.catalog_version snapshot
-- Note: 013 is credit_precharge_allocated; this migration is 014.

-- Legacy Phase-0 table used (billing_sku, effective_from) PK; replace with versioned schema.
ALTER TABLE IF EXISTS price_catalog RENAME TO price_catalog_legacy;

CREATE TABLE IF NOT EXISTS price_catalog (
  billing_sku TEXT NOT NULL,
  version INT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  display_name TEXT NULL,
  meter_kind TEXT NOT NULL,
  input_per_1m NUMERIC NULL,
  output_per_1m NUMERIC NULL,
  image_output_per_1m NUMERIC NULL,
  per_unit NUMERIC NULL,
  user_credits_per_unit INT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  catalog_version TEXT NOT NULL,
  vendor_sku_ref TEXT NULL,
  markup_pct NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (billing_sku, version)
);

CREATE INDEX IF NOT EXISTS idx_price_catalog_sku_effective
  ON price_catalog (billing_sku, effective_from DESC, version DESC)
  WHERE enabled = true;

CREATE TABLE IF NOT EXISTS price_catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS catalog_version TEXT NULL;
