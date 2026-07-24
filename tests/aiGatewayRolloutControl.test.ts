import { describe, expect, it } from 'vitest';
import {
  evaluatePublishDiagnosisGate,
  normalizePublishDiagnosisByModel,
  restorePreviousDispatchPolicy,
  withDispatchPolicyRollbackSnapshot,
} from '../server/ai-gateway/rollout-control.js';
import {
  evaluatePublishDiagnosisGate as evaluateClientGate,
  formatPublishDiagnosisGateMessage,
} from '../services/aiGatewayRolloutControl';

describe('AI Gateway rollout control (A5)', () => {
  it('blocks newly published models without fresh diagnosis', () => {
    const gate = evaluatePublishDiagnosisGate({
      selectedIds: ['gpt-image-2', 'kept-model'],
      previousAllowlist: ['kept-model'],
      snapshots: {
        'kept-model': { ok: true, status: 'ready', auditedAt: new Date().toISOString() },
      },
      nowMs: Date.parse('2026-07-24T12:00:00.000Z'),
    });
    expect(gate.ok).toBe(false);
    expect(gate.forceRequired).toBe(true);
    expect(gate.issues).toEqual([
      expect.objectContaining({
        canonicalModelId: 'gpt-image-2',
        code: 'PUBLISH_DIAGNOSIS_MISSING',
      }),
    ]);
  });

  it('flags stale or failed diagnosis snapshots', () => {
    const gate = evaluatePublishDiagnosisGate({
      selectedIds: ['a', 'b'],
      previousAllowlist: [],
      snapshots: {
        a: { ok: false, status: 'blocked', auditedAt: '2026-07-24T11:00:00.000Z', message: 'key missing' },
        b: { ok: true, status: 'ready', auditedAt: '2026-07-20T11:00:00.000Z' },
      },
      nowMs: Date.parse('2026-07-24T12:00:00.000Z'),
      maxAgeMs: 24 * 60 * 60 * 1000,
    });
    expect(gate.issues.map((row) => row.code).sort()).toEqual([
      'PUBLISH_DIAGNOSIS_FAILED',
      'PUBLISH_DIAGNOSIS_STALE',
    ]);
    expect(gate.ok).toBe(false);
    expect(
      evaluatePublishDiagnosisGate({
        selectedIds: ['a', 'b'],
        previousAllowlist: [],
        snapshots: {
          a: { ok: false, status: 'blocked', auditedAt: '2026-07-24T11:00:00.000Z' },
          b: { ok: true, status: 'ready', auditedAt: '2026-07-20T11:00:00.000Z' },
        },
        nowMs: Date.parse('2026-07-24T12:00:00.000Z'),
        force: true,
      }).ok
    ).toBe(true);
  });

  it('allows force publish and normalizes snapshots', () => {
    expect(
      normalizePublishDiagnosisByModel({
        'gpt-image-2': { status: 'ready', testedAt: '2026-07-24T10:00:00.000Z', message: 'ok' },
      })
    ).toEqual({
      'gpt-image-2': expect.objectContaining({
        ok: true,
        status: 'ready',
        auditedAt: '2026-07-24T10:00:00.000Z',
        source: 'screen',
      }),
    });
    const forced = evaluatePublishDiagnosisGate({
      selectedIds: ['gpt-image-2'],
      previousAllowlist: [],
      snapshots: {},
      force: true,
    });
    expect(forced.ok).toBe(true);
    expect(forced.forceRequired).toBe(true);
  });

  it('snapshots and restores previous dispatchPolicy', () => {
    const current = {
      disabledProviders: [],
      dispatchPolicy: { strategy: 'priority_health_cost', canary: [{ providerId: 'old', percent: 5 }] },
      rollout: { previousDispatchPolicy: null },
    };
    const next = withDispatchPolicyRollbackSnapshot(current, {
      strategy: 'priority_health_cost',
      canary: [{ providerId: 'new', percent: 20 }],
    });
    expect(next.rollout.previousDispatchPolicy).toMatchObject({
      canary: [{ providerId: 'old', percent: 5 }],
    });
    const restored = restorePreviousDispatchPolicy(next);
    expect(restored.restored).toBe(true);
    expect(restored.config.dispatchPolicy).toMatchObject({
      canary: [{ providerId: 'old', percent: 5 }],
    });
  });

  it('keeps client gate message helper aligned', () => {
    const gate = evaluateClientGate({
      selectedIds: ['m1'],
      previousAllowlist: [],
      snapshots: {},
    });
    expect(formatPublishDiagnosisGateMessage(gate.issues)).toContain('发布前诊断门禁');
  });
});
