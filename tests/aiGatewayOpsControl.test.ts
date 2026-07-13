import { describe, expect, it } from 'vitest';

import {
  mergeAiGatewayOpsControlAction,
  normalizeAiGatewayOpsControlConfig,
  pruneExpiredAiGatewayOpsControlConfig,
} from '../server/ai-gateway/ops-control.js';

describe('AI Gateway ops control config', () => {
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
});
