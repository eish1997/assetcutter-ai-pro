import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  insertUsageEvents,
  listUsageEventsForUser,
  summarizeUsageForUser,
} from '../server/usage-billing-store.js';

const DATA_DIR = path.resolve(process.cwd(), 'server/data');
const DB_FILE = path.join(DATA_DIR, 'auth-db.json');

describe('usage-billing user APIs', () => {
  beforeEach(() => {
    process.env.USAGE_BILLING_ENABLED = 'true';
    delete process.env.DATABASE_URL;
    if (fs.existsSync(DB_FILE)) {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db.usageEvents = [];
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    }
  });

  it('listUsageEventsForUser isolates by strict userId', async () => {
    const alice = 'user-alice-usage';
    const bob = 'user-bob-usage';
    await insertUsageEvents(alice, {
      idempotencyKey: 'alice-1',
      provider: 'vertex',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantityIn: 10,
      quantityOut: 5,
      quantity: 15,
      unit: 'token',
      costConfidence: 'exact',
      status: 'succeeded',
      projectId: 'proj-a',
      workflowStepId: 'gen_image',
    });
    await insertUsageEvents(bob, {
      idempotencyKey: 'bob-1',
      provider: 'tripo',
      billingSku: '3d.tripo.task',
      meterKind: 'task',
      quantity: 1,
      unit: 'task',
      costConfidence: 'estimated',
      status: 'succeeded',
      projectId: 'proj-b',
    });

    const aliceList = await listUsageEventsForUser(alice, { limit: 20 });
    expect(aliceList.events.every((e) => e.userId === alice)).toBe(true);
    expect(aliceList.events.some((e) => e.billingSku === 'llm.gemini.flash')).toBe(true);
    expect(aliceList.events.some((e) => e.billingSku === '3d.tripo.task')).toBe(false);

    const bobList = await listUsageEventsForUser(bob, { limit: 20 });
    expect(bobList.events.every((e) => e.userId === bob)).toBe(true);
    expect(bobList.events).toHaveLength(1);
  });

  it('summarizeUsageForUser filters by projectId', async () => {
    const userId = 'user-proj-filter';
    await insertUsageEvents(userId, {
      idempotencyKey: 'p1',
      provider: 'vertex',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantity: 100,
      unit: 'token',
      costConfidence: 'exact',
      status: 'succeeded',
      projectId: 'proj-x',
    });
    await insertUsageEvents(userId, {
      idempotencyKey: 'p2',
      provider: 'vertex',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantity: 200,
      unit: 'token',
      costConfidence: 'exact',
      status: 'succeeded',
      projectId: 'proj-y',
    });

    const all = await summarizeUsageForUser(userId, {});
    expect(all.eventCount).toBe(2);

    const onlyX = await summarizeUsageForUser(userId, { projectId: 'proj-x' });
    expect(onlyX.eventCount).toBe(1);
    expect(onlyX.projectId).toBe('proj-x');
    expect(onlyX.month.eventCount).toBe(1);
  });
});
