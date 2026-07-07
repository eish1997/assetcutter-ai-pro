import fs from 'fs';
import path from 'path';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ADMIN_ROLE_SLUG,
  AUDITOR_ROLE_SLUG,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  SUPER_ROLE_SLUG,
  hasPermission,
} from '../server/admin-permissions.js';
import {
  createCatalogVersion,
  getCatalogEntry,
  patchCatalogVersion,
  listAdminPriceCatalog,
} from '../server/price-catalog-store.js';
import { buildUsageReconciliationSummary } from '../server/admin-usage-reconciliation.js';
import { adjustCredits } from '../server/credit-store.js';
import { insertUsageEvents } from '../server/usage-billing-store.js';
import { resolveAuthDbFileForTests } from './helpers/authDbTestPath.js';

const DB_FILE = resolveAuthDbFileForTests();

function resetPriceCatalogJson() {
  delete process.env.DATABASE_URL;
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let db: Record<string, unknown> = { version: 1, users: [], sessions: [] };
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}');
    } catch {
      /* keep empty */
    }
  }
  db.priceCatalog = { catalogVersion: 'test-seed', entries: [] };
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

describe('admin price catalog', () => {
  beforeEach(() => {
    resetPriceCatalogJson();
  });

  it('super/admin 默认含 pricing.write，auditor 不含', () => {
    expect(DEFAULT_ROLE_PERMISSIONS[SUPER_ROLE_SLUG]).toContain(PERMISSIONS.PRICING_WRITE);
    expect(DEFAULT_ROLE_PERMISSIONS[ADMIN_ROLE_SLUG]).toContain(PERMISSIONS.PRICING_WRITE);
    expect(DEFAULT_ROLE_PERMISSIONS[AUDITOR_ROLE_SLUG]).not.toContain(PERMISSIONS.PRICING_WRITE);
  });

  it('hasPermission 识别 pricing.write', () => {
    expect(hasPermission([PERMISSIONS.PRICING_WRITE], PERMISSIONS.PRICING_WRITE)).toBe(true);
    expect(hasPermission([PERMISSIONS.USAGE_READ], PERMISSIONS.PRICING_WRITE)).toBe(false);
  });

  it('createCatalogVersion 为新 SKU 写入 v1', async () => {
    const entry = await createCatalogVersion({
      billingSku: 'image.test.sku',
      displayName: 'Test Image',
      meterKind: 'image',
      perUnit: 0.05,
      userCreditsPerUnit: 55,
      enabled: true,
    });
    expect(entry.billingSku).toBe('image.test.sku');
    expect(entry.version).toBe(1);
    expect(entry.userCreditsPerUnit).toBe(55);

    const activeEntry = await getCatalogEntry('image.test.sku');
    expect(activeEntry?.billingSku).toBe('image.test.sku');
  });

  it('patchCatalogVersion 递增版本并保留 SKU', async () => {
    await createCatalogVersion({
      billingSku: 'llm.test.patch',
      displayName: 'Patch Test v1',
      meterKind: 'token',
      inputPer1m: 0.1,
      outputPer1m: 0.2,
    });
    const v2 = await patchCatalogVersion('llm.test.patch', {
      displayName: 'Patch Test v2',
      userCreditsPerUnit: 12,
    });
    expect(v2.version).toBe(2);
    expect(v2.displayName).toBe('Patch Test v2');
    expect(v2.userCreditsPerUnit).toBe(12);

    const adminList = await listAdminPriceCatalog();
    const row = adminList.entries.find((e) => e.billingSku === 'llm.test.patch');
    expect(row?.version).toBe(2);
  });
});

describe('usage reconciliation summary', () => {
  const userId = 'reconciliation-test-user';

  beforeEach(() => {
    resetPriceCatalogJson();
    delete process.env.DATABASE_URL;
    process.env.CREDITS_BILLING_ENABLED = 'true';
    process.env.USAGE_BILLING_ENABLED = 'true';
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let db: Record<string, unknown> = { version: 1, users: [], sessions: [], usageEvents: [], creditBalances: {}, creditLedger: [] };
    if (fs.existsSync(DB_FILE)) {
      try {
        db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}') };
      } catch {
        /* keep defaults */
      }
    }
    db.usageEvents = [];
    db.creditBalances = {};
    db.creditLedger = [];
    db.creditReserves = [];
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  });

  it('flags high variance between credits charged and USD estimate', async () => {
    await adjustCredits(userId, 10000, { note: 'seed', createdBy: 'admin-test' });
    await insertUsageEvents(userId, {
      idempotencyKey: 'recon-high-variance',
      provider: 'vertex',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantity: 100,
      unit: 'token',
      costUsdEst: 0.01,
      costConfidence: 'estimated',
      status: 'succeeded',
      creditsCharged: 500,
    });

    const report = await buildUsageReconciliationSummary({});
    const row = report.rows.find((r) => r.billingSku === 'llm.gemini.flash');
    expect(row).toBeTruthy();
    expect(row?.creditsFromUsd).toBe(10);
    expect(row?.flagged).toBe(true);
    expect(row?.flagReasons).toContain('variance>5%');
  });
});
