import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import {
  createAuthAiGatewayJob,
} from '../server/ai-gateway/auth-api-handler.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { updateAiGatewayJobStatus } from '../server/ai-gateway/http-handler.js';
import { adjustCredits, getCreditBalance, validateActiveCreditReserve } from '../server/credit-store.js';
import { resolveAuthDbFileForTests } from './helpers/authDbTestPath.js';

const DB_FILE = resolveAuthDbFileForTests();

function resetCreditJson() {
  delete process.env.DATABASE_URL;
  process.env.CREDITS_BILLING_ENABLED = 'true';
  if (!fs.existsSync(DB_FILE)) return;
  let db = { version: 1, users: [], sessions: [], usageEvents: [], creditBalances: {}, creditLedger: [], creditReserves: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}');
    if (parsed && typeof parsed === 'object') db = { ...db, ...parsed };
  } catch {
    /* keep defaults */
  }
  db.creditBalances = {};
  db.creditLedger = [];
  db.creditReserves = [];
  db.aiGatewayJobs = [];
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function imageJobBody(id: string, estimatedCredits = 30) {
  return {
    id,
    modality: 'image',
    model: 'gemini-3-pro-image-preview',
    estimatedCredits,
    input: {
      contents: [{ role: 'user', parts: [{ text: 'product render' }] }],
    },
  };
}

describe('AI gateway credits settlement', () => {
  const prevMode = process.env.AI_GATEWAY_CREDITS_GATE;
  const user = { id: 'test-ai-gateway-settlement-user', username: 'alice' };

  beforeEach(async () => {
    resetCreditJson();
    process.env.AI_GATEWAY_CREDITS_GATE = 'reserve';
    await adjustCredits(user.id, 100, { note: 'seed', createdBy: 'test' });
  });

  afterEach(() => {
    if (prevMode === undefined) delete process.env.AI_GATEWAY_CREDITS_GATE;
    else process.env.AI_GATEWAY_CREDITS_GATE = prevMode;
  });

  it('reserves credits on job creation and charges the reserve on success', async () => {
    const store = createInMemoryAiJobStore();
    const created = await createAuthAiGatewayJob({}, imageJobBody('aijob_settle_success', 30), user, { store });
    expect(created.status).toBe(202);

    const reserveKey = created.body.job.creditsGate.reserveKey;
    expect(reserveKey).toBe('aijob:aijob_settle_success');
    expect((await getCreditBalance(user.id)).reserved).toBe(30);

    const settled = await updateAiGatewayJobStatus(
      'aijob_settle_success',
      { status: 'succeeded' },
      { store }
    );
    expect(settled.job.metadata.creditsGate).toMatchObject({
      reserveKey,
      settlementAction: 'charged',
      settledCredits: 30,
    });
    const balance = await getCreditBalance(user.id);
    expect(balance.balance).toBe(70);
    expect(balance.reserved).toBe(0);
    expect((await validateActiveCreditReserve(user.id, reserveKey)).ok).toBe(false);
  });

  it('charges actual usage credits when job usage is available', async () => {
    const store = createInMemoryAiJobStore();
    const created = await createAuthAiGatewayJob({}, imageJobBody('aijob_settle_actual', 30), user, { store });
    const reserveKey = created.body.job.creditsGate.reserveKey;
    expect((await getCreditBalance(user.id)).reserved).toBe(30);

    const settled = await updateAiGatewayJobStatus(
      'aijob_settle_actual',
      {
        status: 'succeeded',
        metadata: {
          usage: {
            creditsCharged: 12,
          },
        },
      },
      { store }
    );

    expect(settled.job.metadata.creditsGate).toMatchObject({
      reserveKey,
      settlementAction: 'charged',
      settledCredits: 12,
      estimatedCredits: 30,
      settlementSource: 'job_usage',
    });
    const balance = await getCreditBalance(user.id);
    expect(balance.balance).toBe(88);
    expect(balance.reserved).toBe(0);
    expect((await validateActiveCreditReserve(user.id, reserveKey)).ok).toBe(false);
  });

  it('releases reserved credits when the job fails', async () => {
    const store = createInMemoryAiJobStore();
    const created = await createAuthAiGatewayJob({}, imageJobBody('aijob_settle_failed', 40), user, { store });
    const reserveKey = created.body.job.creditsGate.reserveKey;
    expect((await getCreditBalance(user.id)).reserved).toBe(40);

    const settled = await updateAiGatewayJobStatus(
      'aijob_settle_failed',
      { status: 'failed', error: { code: 'UPSTREAM_429', message: 'Too Many Requests' } },
      { store }
    );
    expect(settled.job.metadata.creditsGate).toMatchObject({
      reserveKey,
      settlementAction: 'released',
    });
    const balance = await getCreditBalance(user.id);
    expect(balance.balance).toBe(100);
    expect(balance.reserved).toBe(0);
  });
});
