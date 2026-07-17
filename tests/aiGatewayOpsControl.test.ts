import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  evaluateAiGatewayProviderAutoCircuit,
  mergeAiGatewayOpsControlAction,
  maybeAutoPauseAiGatewayProvider,
  normalizeAiGatewayOpsControlConfig,
  pruneExpiredAiGatewayOpsControlConfig,
} from '../server/ai-gateway/ops-control.js';

describe('AI Gateway ops control config', () => {
  const prevPath = process.env.AI_GATEWAY_OPS_CONTROL_PATH;
  const prevAuto = process.env.AI_GATEWAY_AUTO_CIRCUIT_ENABLED;
  const tempFiles = new Set<string>();

  afterEach(() => {
    if (prevPath === undefined) delete process.env.AI_GATEWAY_OPS_CONTROL_PATH;
    else process.env.AI_GATEWAY_OPS_CONTROL_PATH = prevPath;
    if (prevAuto === undefined) delete process.env.AI_GATEWAY_AUTO_CIRCUIT_ENABLED;
    else process.env.AI_GATEWAY_AUTO_CIRCUIT_ENABLED = prevAuto;
    for (const file of tempFiles) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // ignore temp cleanup failures
      }
    }
    tempFiles.clear();
  });

  it('normalizes provider/model pauses and model overrides', () => {
    expect(
      normalizeAiGatewayOpsControlConfig({
        disabledProviders: ['vertex-gemini', 'vertex-gemini', '', null],
        disabledModels: ['gemini-pro', '  gemini-pro  ', 'gemini-flash'],
        modelOverrides: [
          { from: 'gemini-pro', to: 'gemini-flash', reason: 'quota' },
          { from: '', to: 'ignored' },
          { from: 'disabled-old', to: 'disabled-new', enabled: false },
        ],
      })
    ).toEqual({
      disabledProviders: ['vertex-gemini'],
      disabledModels: ['gemini-pro', 'gemini-flash'],
      disabledProviderRules: [{ provider: 'vertex-gemini' }],
      disabledModelRules: [{ model: 'gemini-pro' }, { model: 'gemini-flash' }],
      modelOverrides: [
        { from: 'gemini-pro', to: 'gemini-flash', enabled: true, reason: 'quota', expiresAt: null },
        { from: 'disabled-old', to: 'disabled-new', enabled: false, reason: null, expiresAt: null },
      ],
    });
  });

  it('prunes expired TTL rules and keeps future pauses', () => {
    const now = new Date('2026-07-13T10:00:00.000Z');
    const { config, expired } = pruneExpiredAiGatewayOpsControlConfig(
      {
        disabledProviderRules: [
          { provider: 'old', expiresAt: '2026-07-13T09:00:00.000Z' },
          { provider: 'future', expiresAt: '2026-07-13T11:00:00.000Z' },
        ],
        disabledModelRules: [{ model: 'manual', expiresAt: null }],
        modelOverrides: [{ from: 'a', to: 'b', expiresAt: '2026-07-13T09:00:00.000Z' }],
      },
      now
    );

    expect(expired.map((item) => item.key)).toEqual(['old', 'a']);
    expect(config.disabledProviderRules).toEqual([{ provider: 'future', expiresAt: '2026-07-13T11:00:00.000Z' }]);
    expect(config.disabledModelRules).toEqual([{ model: 'manual', expiresAt: null }]);
    expect(config.modelOverrides).toEqual([]);
  });

  it('merges an ops action into a TTL pause rule', () => {
    const config = mergeAiGatewayOpsControlAction(
      { disabledProviders: [], disabledModels: [], modelOverrides: [] },
      { kind: 'provider', key: 'vertex-gemini', ttlMinutes: 60, reason: '429 share' },
      { now: new Date('2026-07-13T10:00:00.000Z'), updatedByUserId: 'user_admin' }
    );

    expect(config.disabledProviders).toEqual(['vertex-gemini']);
    expect(config.disabledProviderRules).toEqual([
      {
        provider: 'vertex-gemini',
        reason: '429 share',
        expiresAt: '2026-07-13T11:00:00.000Z',
        createdAt: '2026-07-13T10:00:00.000Z',
        createdByUserId: 'user_admin',
      },
    ]);
  });

  it('ignores stale auto-circuit provider pauses unless auto circuit is explicitly enabled', () => {
    delete process.env.AI_GATEWAY_AUTO_CIRCUIT_ENABLED;

    expect(
      normalizeAiGatewayOpsControlConfig({
        disabledProviders: ['vertex-site', 'tripo'],
        disabledProviderRules: [
          {
            provider: 'vertex-site',
            reason: 'auto circuit: rate limited',
            expiresAt: '2099-07-13T11:00:00.000Z',
            createdAt: '2026-07-13T10:00:00.000Z',
            createdByUserId: 'system:auto-circuit',
          },
          {
            provider: 'tripo',
            reason: 'manual pause',
            createdByUserId: 'user_admin',
          },
        ],
      }).disabledProviders
    ).toEqual(['tripo']);

    process.env.AI_GATEWAY_AUTO_CIRCUIT_ENABLED = 'true';
    expect(
      normalizeAiGatewayOpsControlConfig({
        disabledProviderRules: [
          {
            provider: 'vertex-site',
            reason: 'auto circuit: rate limited',
            expiresAt: '2099-07-13T11:00:00.000Z',
            createdAt: '2026-07-13T10:00:00.000Z',
            createdByUserId: 'system:auto-circuit',
          },
        ],
      }).disabledProviders
    ).toEqual(['vertex-site']);
  });

  it('ignores legacy auto-circuit snapshots that only persisted disabledProviders', () => {
    delete process.env.AI_GATEWAY_AUTO_CIRCUIT_ENABLED;

    expect(
      normalizeAiGatewayOpsControlConfig({
        disabledProviders: ['vertex-site', 'gemini-aistudio'],
        disabledProviderRules: [],
        updatedByUserId: 'system:auto-circuit',
      }).disabledProviders
    ).toEqual([]);

    expect(
      normalizeAiGatewayOpsControlConfig({
        disabledProviders: ['vertex-site'],
        updatedByUserId: 'user_admin',
      }).disabledProviders
    ).toEqual(['vertex-site']);

    expect(
      normalizeAiGatewayOpsControlConfig(
        {
          disabledProviders: ['vertex-site', 'volcengine-ark'],
          disabledProviderRules: [],
        },
        { updatedByUserId: 'system:auto-circuit' }
      ).disabledProviders
    ).toEqual([]);
  });

  function plan(provider: string, status: string, message = '') {
    return {
      job: {
        id: `job_${provider}_${status}_${Math.random().toString(36).slice(2)}`,
        provider,
        status,
        modality: 'model3d',
        capability: 'model3d.generate',
        correlationId: 'corr',
        createdAt: '2026-07-13T10:00:00.000Z',
        updatedAt: '2026-07-13T10:01:00.000Z',
        startedAt: '2026-07-13T10:00:00.000Z',
        finishedAt: '2026-07-13T10:01:00.000Z',
        error: message ? { code: 'UPSTREAM', message } : null,
      },
      route: { providerId: provider },
    };
  }

  it('does not auto-pause a provider on one isolated handoff failure', async () => {
    const file = path.join(os.tmpdir(), `ac-aig-ops-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.add(file);
    process.env.AI_GATEWAY_OPS_CONTROL_PATH = file;
    process.env.AI_GATEWAY_AUTO_CIRCUIT_ENABLED = 'true';

    const config = await maybeAutoPauseAiGatewayProvider(
      { route: { providerId: 'tripo' }, job: { provider: 'tripo', status: 'failed' } },
      new Error('HTTP 429 Too Many Requests')
    );

    expect(config).toBeNull();
  });

  it('keeps auto-pause disabled by default even when failures cross the threshold', async () => {
    const file = path.join(os.tmpdir(), `ac-aig-ops-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.add(file);
    process.env.AI_GATEWAY_OPS_CONTROL_PATH = file;
    delete process.env.AI_GATEWAY_AUTO_CIRCUIT_ENABLED;

    const config = await maybeAutoPauseAiGatewayProvider(
      plan('vertex-site', 'failed', 'HTTP 429 Too Many Requests'),
      new Error('HTTP 429 Too Many Requests'),
      {
        recentPlans: [plan('vertex-site', 'failed', 'HTTP 429 Too Many Requests'), plan('vertex-site', 'succeeded')],
        ttlMinutes: 5,
      }
    );

    expect(config).toBeNull();
  });

  it('evaluates recent provider failures before recommending an auto pause', () => {
    const action = evaluateAiGatewayProviderAutoCircuit(
      [
        plan('tripo', 'failed', 'HTTP 429 Too Many Requests'),
        plan('tripo', 'failed', 'HTTP 503 upstream unavailable'),
        plan('tripo', 'succeeded'),
      ],
      'tripo',
      { enabled: true, minTerminal: 3, minFailures: 2, ttlMinutes: 15 }
    );

    expect(action).toMatchObject({
      kind: 'provider',
      key: 'tripo',
      ttlMinutes: 15,
      stats: {
        terminal: 3,
        failed: 2,
        rateLimited: 1,
      },
    });
  });

  it('auto-pauses a provider when recent failures cross the circuit threshold', async () => {
    const file = path.join(os.tmpdir(), `ac-aig-ops-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.add(file);
    process.env.AI_GATEWAY_OPS_CONTROL_PATH = file;
    process.env.AI_GATEWAY_AUTO_CIRCUIT_ENABLED = 'true';

    const config = await maybeAutoPauseAiGatewayProvider(
      plan('tripo', 'failed', 'HTTP 429 Too Many Requests'),
      new Error('HTTP 429 Too Many Requests'),
      {
        recentPlans: [plan('tripo', 'failed', 'HTTP 503 upstream unavailable'), plan('tripo', 'succeeded')],
        ttlMinutes: 5,
      }
    );

    expect(config?.disabledProviders).toEqual(['tripo']);
    expect(config?.disabledProviderRules?.[0]).toMatchObject({
      provider: 'tripo',
      createdByUserId: 'system:auto-circuit',
    });
    expect(config?.autoCircuitAction?.stats).toMatchObject({ terminal: 3, failed: 2 });
  });
});
