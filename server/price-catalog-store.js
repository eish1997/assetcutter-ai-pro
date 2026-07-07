/**
 * B4 — price_catalog runtime store (Postgres or auth-db.json mirror).
 * Bootstrap seed: server/usage-price-catalog.js DEFAULT_PRICE_CATALOG.
 */
import crypto from 'crypto';
import { readDb, writeDb, USE_POSTGRES, getPool, ensurePostgres } from './auth-store.js';
import { DEFAULT_PRICE_CATALOG } from './usage-price-catalog.js';
import { CREDITS_PER_USD } from './credits-math.js';

const META_CATALOG_VERSION_KEY = 'catalog_version';
const SEED_CATALOG_VERSION = 'seed-v1';
const METER_KINDS = new Set(['token', 'image', 'second', 'task', 'byte']);

/** PG 模式下 pricing-engine 同步读路径用的内存快照（由 async 写入路径刷新）。 */
let runtimeCatalogCache = null;

function nowIso() {
  return new Date().toISOString();
}

function computeUserCreditsPerUnit(entry) {
  if (entry.userCreditsPerUnit != null && Number.isFinite(Number(entry.userCreditsPerUnit))) {
    return Math.floor(Number(entry.userCreditsPerUnit));
  }
  const per = entry.perUnit != null ? Number(entry.perUnit) : null;
  if (per != null && Number.isFinite(per) && per > 0) {
    return Math.ceil(per * CREDITS_PER_USD);
  }
  if (String(entry.meterKind || '') === 'token') {
    return null;
  }
  const sku = String(entry.billingSku || entry.billing_sku || '');
  if (sku.startsWith('llm.')) return 1;
  return null;
}

function seedEntryFromDefault(raw, catalogVersion) {
  const billingSku = String(raw.billingSku || '').trim();
  if (!billingSku) return null;
  const userCredits = computeUserCreditsPerUnit(raw);
  return {
    billingSku,
    version: 1,
    effectiveFrom: nowIso(),
    displayName: raw.displayName ?? null,
    meterKind: String(raw.meterKind || 'task'),
    inputPer1m: raw.inputPer1m ?? null,
    outputPer1m: raw.outputPer1m ?? null,
    imageOutputPer1m: raw.imageOutputPer1m ?? null,
    perUnit: raw.perUnit ?? null,
    userCreditsPerUnit: userCredits,
    enabled: true,
    catalogVersion,
    vendorSkuRef: raw.vendorSkuRef ?? null,
    markupPct: raw.markupPct ?? 0,
  };
}

function mapPgRow(r) {
  return {
    billingSku: r.billing_sku,
    version: Number(r.version),
    effectiveFrom: r.effective_from,
    displayName: r.display_name,
    meterKind: r.meter_kind,
    inputPer1m: r.input_per_1m != null ? Number(r.input_per_1m) : null,
    outputPer1m: r.output_per_1m != null ? Number(r.output_per_1m) : null,
    imageOutputPer1m: r.image_output_per_1m != null ? Number(r.image_output_per_1m) : null,
    perUnit: r.per_unit != null ? Number(r.per_unit) : null,
    userCreditsPerUnit:
      r.user_credits_per_unit != null ? Number(r.user_credits_per_unit) : null,
    enabled: Boolean(r.enabled),
    catalogVersion: String(r.catalog_version || ''),
    vendorSkuRef: r.vendor_sku_ref ?? null,
    markupPct: r.markup_pct != null ? Number(r.markup_pct) : 0,
  };
}

function mapJsonRow(r) {
  return {
    billingSku: r.billingSku,
    version: Number(r.version),
    effectiveFrom: r.effectiveFrom,
    displayName: r.displayName ?? null,
    meterKind: r.meterKind,
    inputPer1m: r.inputPer1m ?? null,
    outputPer1m: r.outputPer1m ?? null,
    imageOutputPer1m: r.imageOutputPer1m ?? null,
    perUnit: r.perUnit ?? null,
    userCreditsPerUnit: r.userCreditsPerUnit ?? null,
    enabled: r.enabled !== false,
    catalogVersion: String(r.catalogVersion || ''),
    vendorSkuRef: r.vendorSkuRef ?? null,
    markupPct: r.markupPct ?? 0,
  };
}

/** Pricing-engine compatible shape (camelCase, billingSku key). */
export function toPricingCatalogEntry(entry) {
  if (!entry) return null;
  return {
    billingSku: entry.billingSku,
    meterKind: entry.meterKind,
    inputPer1m: entry.inputPer1m,
    outputPer1m: entry.outputPer1m,
    imageOutputPer1m: entry.imageOutputPer1m,
    perUnit: entry.perUnit,
    displayName: entry.displayName,
    vendorSkuRef: entry.vendorSkuRef,
    markupPct: entry.markupPct ?? 0,
    userCreditsPerUnit: entry.userCreditsPerUnit,
  };
}

function ensureJsonSection(db) {
  if (!db.priceCatalog || typeof db.priceCatalog !== 'object') {
    db.priceCatalog = { catalogVersion: SEED_CATALOG_VERSION, entries: [] };
  }
  if (!Array.isArray(db.priceCatalog.entries)) db.priceCatalog.entries = [];
  if (!db.priceCatalog.catalogVersion) db.priceCatalog.catalogVersion = SEED_CATALOG_VERSION;
  return db.priceCatalog;
}

async function seedPostgresIfEmpty(client) {
  const count = await client.query(`SELECT COUNT(*)::int AS c FROM price_catalog`);
  if (Number(count.rows[0]?.c || 0) > 0) return;

  const catalogVersion = SEED_CATALOG_VERSION;
  for (const raw of DEFAULT_PRICE_CATALOG) {
    const row = seedEntryFromDefault(raw, catalogVersion);
    if (!row) continue;
    await client.query(
      `INSERT INTO price_catalog
       (billing_sku, version, effective_from, display_name, meter_kind,
        input_per_1m, output_per_1m, image_output_per_1m, per_unit, user_credits_per_unit,
        enabled, catalog_version, vendor_sku_ref, markup_pct)
       VALUES ($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (billing_sku, version) DO NOTHING`,
      [
        row.billingSku,
        row.version,
        row.effectiveFrom,
        row.displayName,
        row.meterKind,
        row.inputPer1m,
        row.outputPer1m,
        row.imageOutputPer1m,
        row.perUnit,
        row.userCreditsPerUnit,
        row.enabled,
        row.catalogVersion,
        row.vendorSkuRef,
        row.markupPct,
      ]
    );
  }
  await client.query(
    `INSERT INTO price_catalog_meta (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [META_CATALOG_VERSION_KEY, catalogVersion]
  );
}

function seedJsonIfEmpty(db) {
  const section = ensureJsonSection(db);
  if (section.entries.length > 0) return false;

  const catalogVersion = SEED_CATALOG_VERSION;
  section.catalogVersion = catalogVersion;
  section.entries = DEFAULT_PRICE_CATALOG.map((raw) => seedEntryFromDefault(raw, catalogVersion)).filter(Boolean);
  return true;
}

export async function ensurePriceCatalogStore() {
  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    await p.query(`
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
    `);
    await p.query(`
      CREATE TABLE IF NOT EXISTS price_catalog_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await p.query(`ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS catalog_version TEXT NULL;`);
    await seedPostgresIfEmpty(p);
    await refreshRuntimeCatalogCache();
    return;
  }

  const db = readDb();
  if (seedJsonIfEmpty(db)) writeDb(db);
}

function effectiveAtIso(effectiveAt) {
  if (effectiveAt) {
    const d = new Date(effectiveAt);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return nowIso();
}

function pickLatestPerSku(entries, effectiveAtIso) {
  const cutoff = Date.parse(effectiveAtIso);
  const bySku = new Map();
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const eff = Date.parse(String(entry.effectiveFrom || ''));
    if (!Number.isFinite(eff) || eff > cutoff) continue;
    const sku = entry.billingSku;
    const prev = bySku.get(sku);
    if (!prev || entry.version > prev.version) {
      bySku.set(sku, entry);
    } else if (entry.version === prev.version && eff > Date.parse(String(prev.effectiveFrom || ''))) {
      bySku.set(sku, entry);
    }
  }
  return [...bySku.values()].sort((a, b) => String(a.billingSku).localeCompare(String(b.billingSku)));
}

async function refreshRuntimeCatalogCache() {
  if (!USE_POSTGRES) {
    runtimeCatalogCache = null;
    return;
  }
  const at = effectiveAtIso();
  const p = getPool();
  const res = await p.query(
    `SELECT DISTINCT ON (billing_sku) *
     FROM price_catalog
     WHERE enabled = true AND effective_from <= $1::timestamptz
     ORDER BY billing_sku, version DESC, effective_from DESC`,
    [at]
  );
  const entries = res.rows.map(mapPgRow);
  const meta = await p.query(`SELECT value FROM price_catalog_meta WHERE key = $1`, [
    META_CATALOG_VERSION_KEY,
  ]);
  let catalogVersion = meta.rows[0]?.value ? String(meta.rows[0].value) : '';
  if (!catalogVersion) {
    const verRes = await p.query(
      `SELECT catalog_version FROM price_catalog ORDER BY effective_from DESC, version DESC LIMIT 1`
    );
    catalogVersion = verRes.rows[0]?.catalog_version
      ? String(verRes.rows[0].catalog_version)
      : SEED_CATALOG_VERSION;
  }
  runtimeCatalogCache = { entries, catalogVersion };
}

/**
 * @param {string|Date} [effectiveAt]
 */
export async function listActiveCatalog(effectiveAt) {
  const at = effectiveAtIso(effectiveAt);
  await ensurePriceCatalogStore();

  if (USE_POSTGRES) {
    const p = getPool();
    const res = await p.query(
      `SELECT DISTINCT ON (billing_sku) *
       FROM price_catalog
       WHERE enabled = true AND effective_from <= $1::timestamptz
       ORDER BY billing_sku, version DESC, effective_from DESC`,
      [at]
    );
    return res.rows.map(mapPgRow);
  }

  const db = readDb();
  const section = ensureJsonSection(db);
  return pickLatestPerSku(section.entries.map(mapJsonRow), at);
}

/**
 * @param {string} billingSku
 * @param {string|Date} [effectiveAt]
 */
export async function getCatalogEntry(billingSku, effectiveAt) {
  const sku = String(billingSku || '').trim();
  if (!sku) return null;
  const catalog = await listActiveCatalog(effectiveAt);
  return catalog.find((e) => e.billingSku === sku) ?? null;
}

export async function getCatalogVersion() {
  await ensurePriceCatalogStore();

  if (USE_POSTGRES) {
    const p = getPool();
    const meta = await p.query(`SELECT value FROM price_catalog_meta WHERE key = $1`, [
      META_CATALOG_VERSION_KEY,
    ]);
    if (meta.rows[0]?.value) return String(meta.rows[0].value);
    const res = await p.query(
      `SELECT catalog_version FROM price_catalog ORDER BY effective_from DESC, version DESC LIMIT 1`
    );
    return res.rows[0]?.catalog_version ? String(res.rows[0].catalog_version) : SEED_CATALOG_VERSION;
  }

  const db = readDb();
  const section = ensureJsonSection(db);
  return String(section.catalogVersion || SEED_CATALOG_VERSION);
}

/** Sync read for JSON mode / tests; PG 模式读内存快照（ensurePriceCatalogStore 后可用）。 */
export function listActiveCatalogSync(effectiveAt) {
  const at = effectiveAtIso(effectiveAt);
  if (USE_POSTGRES) {
    if (runtimeCatalogCache?.entries?.length) {
      return pickLatestPerSku(runtimeCatalogCache.entries, at);
    }
    return DEFAULT_PRICE_CATALOG.map((raw) => seedEntryFromDefault(raw, SEED_CATALOG_VERSION)).filter(Boolean);
  }
  const db = readDb();
  const section = ensureJsonSection(db);
  if (section.entries.length === 0) {
    seedJsonIfEmpty(db);
    writeDb(db);
  }
  return pickLatestPerSku(section.entries.map(mapJsonRow), at);
}

export function getCatalogVersionSync() {
  if (USE_POSTGRES) {
    return runtimeCatalogCache?.catalogVersion ?? SEED_CATALOG_VERSION;
  }
  const db = readDb();
  const section = ensureJsonSection(db);
  if (section.entries.length === 0) {
    seedJsonIfEmpty(db);
    writeDb(db);
  }
  return String(section.catalogVersion || SEED_CATALOG_VERSION);
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function newCatalogVersionTag() {
  return `v-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeVersionInput(billingSku, version, catalogVersion, fields) {
  const meterKind = String(fields.meterKind || 'task').trim();
  if (!METER_KINDS.has(meterKind)) {
    throw new Error(`无效 meterKind: ${meterKind}`);
  }
  const perUnit = parseOptionalNumber(fields.perUnit ?? fields.costUsdPerUnit);
  let userCreditsPerUnit = parseOptionalNumber(fields.userCreditsPerUnit);
  if (userCreditsPerUnit != null) userCreditsPerUnit = Math.floor(userCreditsPerUnit);
  if (userCreditsPerUnit == null && perUnit != null && perUnit > 0) {
    userCreditsPerUnit = Math.ceil(perUnit * CREDITS_PER_USD);
  }
  return {
    billingSku,
    version,
    effectiveFrom: effectiveAtIso(fields.effectiveFrom),
    displayName: fields.displayName != null ? String(fields.displayName).slice(0, 200) : null,
    meterKind,
    inputPer1m: parseOptionalNumber(fields.inputPer1m),
    outputPer1m: parseOptionalNumber(fields.outputPer1m),
    imageOutputPer1m: parseOptionalNumber(fields.imageOutputPer1m),
    perUnit,
    userCreditsPerUnit,
    enabled: fields.enabled !== false,
    catalogVersion,
    vendorSkuRef: fields.vendorSkuRef != null ? String(fields.vendorSkuRef).slice(0, 120) : null,
    markupPct: parseOptionalNumber(fields.markupPct) ?? 0,
  };
}

async function nextVersionForSku(billingSku) {
  await ensurePriceCatalogStore();
  const sku = String(billingSku || '').trim();
  if (!sku) return 1;

  if (USE_POSTGRES) {
    const p = getPool();
    const res = await p.query(
      `SELECT COALESCE(MAX(version), 0)::int AS max_v FROM price_catalog WHERE billing_sku = $1`,
      [sku]
    );
    return Number(res.rows[0]?.max_v || 0) + 1;
  }

  const active = await getCatalogEntry(sku);
  let max = active?.version != null ? Number(active.version) || 0 : 0;
  const db = readDb();
  const section = ensureJsonSection(db);
  for (const entry of section.entries) {
    if (String(entry.billingSku || '') === sku) {
      max = Math.max(max, Number(entry.version) || 0);
    }
  }
  return max + 1;
}

async function bumpCatalogVersionMeta(catalogVersion) {
  if (USE_POSTGRES) {
    const p = getPool();
    await p.query(
      `INSERT INTO price_catalog_meta (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [META_CATALOG_VERSION_KEY, catalogVersion]
    );
    return;
  }
  const db = readDb();
  const section = ensureJsonSection(db);
  section.catalogVersion = catalogVersion;
  writeDb(db);
}

async function insertVersionRow(row) {
  if (USE_POSTGRES) {
    const p = getPool();
    await p.query(
      `INSERT INTO price_catalog
       (billing_sku, version, effective_from, display_name, meter_kind,
        input_per_1m, output_per_1m, image_output_per_1m, per_unit, user_credits_per_unit,
        enabled, catalog_version, vendor_sku_ref, markup_pct)
       VALUES ($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        row.billingSku,
        row.version,
        row.effectiveFrom,
        row.displayName,
        row.meterKind,
        row.inputPer1m,
        row.outputPer1m,
        row.imageOutputPer1m,
        row.perUnit,
        row.userCreditsPerUnit,
        row.enabled,
        row.catalogVersion,
        row.vendorSkuRef,
        row.markupPct,
      ]
    );
    return;
  }
  const db = readDb();
  const section = ensureJsonSection(db);
  section.entries.push(row);
  writeDb(db);
}

/**
 * Create a new version row for billingSku (POST).
 * @param {Record<string, unknown>} input
 */
export async function createCatalogVersion(input) {
  const billingSku = String(input?.billingSku || '').trim();
  if (!billingSku || billingSku.length > 120) throw new Error('billingSku 无效');

  const version = await nextVersionForSku(billingSku);
  const catalogVersion = newCatalogVersionTag();
  const row = normalizeVersionInput(billingSku, version, catalogVersion, input || {});
  await insertVersionRow(row);
  await bumpCatalogVersionMeta(catalogVersion);
  await refreshRuntimeCatalogCache();
  return row;
}

/**
 * Create a new version for an existing SKU (PATCH), merging with current active entry.
 * @param {string} billingSku
 * @param {Record<string, unknown>} patch
 */
export async function patchCatalogVersion(billingSku, patch) {
  const sku = String(billingSku || '').trim();
  if (!sku) throw new Error('billingSku 无效');
  const existing = await getCatalogEntry(sku);
  if (!existing) throw new Error(`SKU 不存在: ${sku}`);
  return createCatalogVersion({ ...existing, ...patch, billingSku: sku });
}

/** Admin list payload: active entries + catalog version tag. */
export async function listAdminPriceCatalog() {
  const [entries, catalogVersion] = await Promise.all([listActiveCatalog(), getCatalogVersion()]);
  return { catalogVersion, entries };
}
