import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'fs';
import {
  ensurePriceCatalogStore,
  getCatalogEntry,
  getCatalogVersion,
  getCatalogVersionSync,
  listActiveCatalog,
  listActiveCatalogSync,
} from '../server/price-catalog-store.js';
import { DEFAULT_PRICE_CATALOG } from '../server/usage-price-catalog.js';
import { resolveAuthDbFileForTests } from './helpers/authDbTestPath.js';

const DB_FILE = resolveAuthDbFileForTests();

function resetPriceCatalogJson() {
  delete process.env.DATABASE_URL;
  if (!fs.existsSync(DB_FILE)) return;
  let db = { version: 1, users: [], sessions: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}');
    if (parsed && typeof parsed === 'object') db = { ...db, ...parsed };
  } catch {
    /* keep defaults */
  }
  delete db.priceCatalog;
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

describe('priceCatalogStore (JSON mode)', () => {
  beforeEach(() => {
    resetPriceCatalogJson();
  });

  it('seeds from DEFAULT_PRICE_CATALOG on first access', async () => {
    await ensurePriceCatalogStore();
    const catalog = await listActiveCatalog();
    expect(catalog.length).toBe(DEFAULT_PRICE_CATALOG.length);
    const flash = catalog.find((e) => e.billingSku === 'llm.gemini.flash');
    expect(flash?.inputPer1m).toBe(0.15);
    expect(flash?.enabled).toBe(true);
  });

  it('backfills new default SKUs into an existing seeded catalog', async () => {
    await ensurePriceCatalogStore();
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.priceCatalog.entries = db.priceCatalog.entries.filter(
      (entry: { billingSku?: string }) => entry.billingSku !== 'copilot.codex.tokens',
    );
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');

    await ensurePriceCatalogStore();
    const entry = await getCatalogEntry('copilot.codex.tokens');
    expect(entry).toMatchObject({
      billingSku: 'copilot.codex.tokens',
      meterKind: 'token',
      userCreditsPerUnit: 1,
      enabled: true,
    });
  });

  it('listActiveCatalog returns latest version per billing_sku', async () => {
    await ensurePriceCatalogStore();
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.priceCatalog.entries.push({
      billingSku: 'llm.gemini.flash',
      version: 2,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      displayName: 'Gemini Flash v2',
      meterKind: 'token',
      inputPer1m: 0.2,
      outputPer1m: 0.7,
      enabled: true,
      catalogVersion: 'seed-v2',
    });
    db.priceCatalog.catalogVersion = 'seed-v2';
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');

    const catalog = await listActiveCatalog();
    const flash = catalog.find((e) => e.billingSku === 'llm.gemini.flash');
    expect(flash?.version).toBe(2);
    expect(flash?.inputPer1m).toBe(0.2);
  });

  it('getCatalogEntry resolves a single sku', async () => {
    await ensurePriceCatalogStore();
    const entry = await getCatalogEntry('image.gemini.flash');
    expect(entry?.perUnit).toBeCloseTo(0.039, 5);
    expect(entry?.userCreditsPerUnit).toBe(39);
  });

  it('getCatalogVersion returns global snapshot string', async () => {
    await ensurePriceCatalogStore();
    const version = await getCatalogVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
    expect(getCatalogVersionSync()).toBe(version);
  });

  it('listActiveCatalogSync mirrors async catalog in JSON mode', async () => {
    await ensurePriceCatalogStore();
    const asyncCatalog = await listActiveCatalog();
    const syncCatalog = listActiveCatalogSync();
    expect(syncCatalog.map((e) => e.billingSku)).toEqual(asyncCatalog.map((e) => e.billingSku));
  });

  it('listActiveCatalogSync reflects admin override in JSON mode', async () => {
    await ensurePriceCatalogStore();
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.priceCatalog.entries.push({
      billingSku: 'image.gemini.flash',
      version: 2,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      displayName: 'Gemini Flash admin',
      meterKind: 'image',
      perUnit: 0.039,
      userCreditsPerUnit: 88,
      enabled: true,
      catalogVersion: 'admin-v1',
    });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');

    const syncEntry = listActiveCatalogSync().find((e) => e.billingSku === 'image.gemini.flash');
    expect(syncEntry?.userCreditsPerUnit).toBe(88);
  });
});
