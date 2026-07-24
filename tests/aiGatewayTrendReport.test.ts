import { describe, expect, it } from 'vitest';
import fs from 'fs';

import {
  buildAiGatewayTrendReportFromInputs,
  listAiGatewayTrendSnapshots,
  saveAiGatewayTrendSnapshot,
} from '../server/ai-gateway/trend-report.js';
import { resolveAuthDbFileForTests } from './helpers/authDbTestPath.js';

function job(id: string, status: string, provider: string, createdAt: string, message = '', extra: Record<string, unknown> = {}) {
  return {
    job: {
      id,
      status,
      provider,
      model: 'model-a',
      capability: 'image.generate',
      createdAt,
      updatedAt: createdAt,
      ...(extra.job || {}),
      error: message ? { code: 'UPSTREAM', message } : null,
    },
    route: { providerId: provider },
  };
}

describe('AI Gateway trend report', () => {
  it('summarizes jobs and usage events by day/provider/sku', () => {
    const report = buildAiGatewayTrendReportFromInputs({
      days: 7,
      generatedAt: '2026-07-14T00:00:00.000Z',
      jobs: [
        job('j1', 'succeeded', 'vertex-gemini', '2026-07-13T10:00:00.000Z', '', {
          job: {
            startedAt: '2026-07-13T10:00:00.000Z',
            finishedAt: '2026-07-13T10:00:04.000Z',
          },
        }),
        job('j2', 'failed', 'vertex-gemini', '2026-07-13T11:00:00.000Z', 'HTTP 429 Too Many Requests', {
          job: {
            startedAt: '2026-07-13T11:00:00.000Z',
            finishedAt: '2026-07-13T11:00:02.000Z',
            metadata: {
              aiGatewayFallback: {
                attempts: [{ providerId: 'vertex-gemini', reason: 'rate_limit' }],
              },
            },
          },
        }),
        job('j3', 'failed', 'tripo', '2026-07-14T11:00:00.000Z', 'HTTP 503 upstream unavailable'),
      ],
      usageEvents: [
        {
          id: 'u1',
          provider: 'vertex-gemini',
          billingSku: 'image.gemini',
          status: 'succeeded',
          quantity: 1,
          costUsdEst: 0.01,
          creditsCharged: 10,
          createdAt: '2026-07-13T12:00:00.000Z',
        },
        {
          id: 'u2',
          provider: 'tripo',
          billingSku: '3d.tripo.task',
          status: 'succeeded',
          quantity: 1,
          costUsdEst: 0.2,
          creditsCharged: 50,
          createdAt: '2026-07-14T12:00:00.000Z',
        },
      ],
    });

    expect(report.jobs.totals).toMatchObject({
      total: 3,
      succeeded: 1,
      failed: 2,
      rateLimited: 1,
    });
    expect(report.jobs.byProvider.find((row) => row.key === 'vertex-gemini')).toMatchObject({
      total: 2,
      failed: 1,
      rateLimited: 1,
      fallbackAttempts: 1,
      avgDurationMs: 3000,
    });
    expect(report.usage.totals).toMatchObject({
      eventCount: 2,
      totalCreditsCharged: 60,
    });
    expect(report.usage.bySku.map((row) => row.key)).toContain('3d.tripo.task');
    expect(report.jobs.byDay.map((row) => row.key)).toEqual(['2026-07-13', '2026-07-14']);
    expect(report.providerPerformance.find((row) => row.providerId === 'vertex-gemini')).toMatchObject({
      totalJobs: 2,
      failedJobs: 1,
      rateLimitedJobs: 1,
      fallbackAttempts: 1,
      avgDurationMs: 3000,
      usageEvents: 1,
      totalCostUsdEst: 0.01,
      totalCreditsCharged: 10,
    });
  });

  it('persists daily trend snapshots in the JSON fallback store', async () => {
    const dbFile = resolveAuthDbFileForTests();
    const db = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : { version: 1, users: [], sessions: [] };
    db.aiGatewayTrendSnapshots = [];
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');

    const report = buildAiGatewayTrendReportFromInputs({
      generatedAt: '2026-07-14T08:00:00.000Z',
      jobs: [job('j1', 'succeeded', 'tripo', '2026-07-14T07:00:00.000Z')],
      usageEvents: [],
    });
    await saveAiGatewayTrendSnapshot(report, '2026-07-14');
    await saveAiGatewayTrendSnapshot({ ...report, generatedAt: '2026-07-14T09:00:00.000Z' }, '2026-07-14');

    const snapshots = await listAiGatewayTrendSnapshots({
      days: 7,
      now: new Date('2026-07-14T10:00:00.000Z'),
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      day: '2026-07-14',
      version: 1,
      generatedAt: '2026-07-14T09:00:00.000Z',
    });
    expect(snapshots[0].report.snapshot).toMatchObject({ day: '2026-07-14', version: 1 });
  });
});
