import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { insertUsageEvents, listUsageEventsForAdmin } from '../server/usage-billing-store.js';

const DATA_DIR = path.resolve(process.cwd(), 'server/data');
const DB_FILE = path.join(DATA_DIR, 'auth-db.json');

describe('usage-billing-store', () => {
  beforeEach(() => {
    process.env.USAGE_BILLING_ENABLED = 'true';
    delete process.env.DATABASE_URL;
    if (fs.existsSync(DB_FILE)) {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db.usageEvents = [];
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    }
  });

  it('inserts with idempotency', async () => {
    const userId = 'test-user-usage-1';
    const event = {
      idempotencyKey: 'test-key-1',
      provider: 'vertex',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantityIn: 100,
      quantityOut: 50,
      quantity: 150,
      unit: 'token',
      costConfidence: 'exact',
      status: 'succeeded',
    };
    const r1 = await insertUsageEvents(userId, event);
    expect(r1.inserted).toBe(1);
    const r2 = await insertUsageEvents(userId, event);
    expect(r2.inserted).toBe(0);
    expect(r2.skipped).toBe(1);
  });

  it('lists events for admin', async () => {
    const userId = 'test-user-usage-2';
    await insertUsageEvents(userId, {
      idempotencyKey: 'test-key-2',
      provider: 'tripo',
      billingSku: '3d.tripo.task',
      meterKind: 'task',
      quantity: 1,
      unit: 'task',
      costConfidence: 'estimated',
      status: 'succeeded',
      upstreamTaskId: 'tsk_demo',
    });
    const list = await listUsageEventsForAdmin({ userId, limit: 10 });
    expect(list.events.length).toBeGreaterThanOrEqual(1);
    expect(list.events[0].billingSku).toBe('3d.tripo.task');
  });
});
