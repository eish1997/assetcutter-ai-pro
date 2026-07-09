import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  AiPipelineStepError,
  detectPipelineStepFromMessage,
  formatAiPipelineStepError,
} from '../services/aiPipelineStepError';
import {
  beginAiTaskEnvelope,
  endAiTaskEnvelope,
  finalizeAiTaskEnvelopeCredits,
  getActiveAiTaskEnvelopeId,
  getEnvelopeProxyAdmissionHeaders,
  prepareAiTaskEnvelopeCredits,
  runInAiTaskEnvelope,
} from '../services/aiTaskEnvelope';

vi.mock('../services/creditsProxyBridge', () => ({
  getCreditsProxyRequestHeaders: vi.fn(async (n: number) => ({
    'X-AC-Credits-Reserve': `proxy:test-${n}`,
    'X-AC-Credits-Gate-Signature': 'sig',
    'X-AC-Credits-Gate-Estimate': String(n),
  })),
  markCreditsProxyHeadersFromGate: vi.fn(),
  releaseCreditsProxyReserve: vi.fn(async () => {}),
  clearLastCreditsReserveKey: vi.fn(),
}));

vi.mock('../services/creditsPrechargeSession', () => ({
  peekCreditsPrechargeSession: vi.fn(() => null),
}));

vi.mock('../services/geminiFairnessBridge', () => ({
  getGeminiFairnessRequestHeaders: vi.fn(() => ({ 'X-AC-Fairness-Key': 'user:u1' })),
}));

import { getCreditsProxyRequestHeaders, releaseCreditsProxyReserve, clearLastCreditsReserveKey } from '../services/creditsProxyBridge';

describe('aiPipelineStepError', () => {
  it('formats step label prefix once', () => {
    expect(formatAiPipelineStepError('understand', '网关超时')).toBe('[理解步] 网关超时');
    expect(formatAiPipelineStepError('understand', '[理解步] 已有前缀')).toBe('[理解步] 已有前缀');
  });

  it('detects step from formatted message', () => {
    expect(detectPipelineStepFromMessage('[积分准入] 无效')).toBe('credits_gate');
    expect(detectPipelineStepFromMessage('Too Many Requests')).toBeNull();
  });

  it('AiPipelineStepError carries step and code', () => {
    const err = new AiPipelineStepError('credits_gate', 'CREDITS_RESERVE_INVALID', '积分预扣无效');
    expect(err.step).toBe('credits_gate');
    expect(err.code).toBe('CREDITS_RESERVE_INVALID');
    expect(err.message).toContain('[积分准入]');
  });
});

describe('aiTaskEnvelope', () => {
  beforeEach(() => {
    endAiTaskEnvelope('any');
    vi.mocked(getCreditsProxyRequestHeaders).mockClear();
    vi.mocked(releaseCreditsProxyReserve).mockClear();
  });

  it('tracks active envelope until end', async () => {
    expect(getActiveAiTaskEnvelopeId()).toBeNull();
    await runInAiTaskEnvelope('task-a', async () => {
      expect(getActiveAiTaskEnvelopeId()).toBe('task-a');
    });
    expect(getActiveAiTaskEnvelopeId()).toBeNull();
  });

  it('prepareAiTaskEnvelopeCredits fetches bundle once for sum of steps', async () => {
    beginAiTaskEnvelope('task-credits');
    const total = await prepareAiTaskEnvelopeCredits([
      { kind: 'platform', minCredits: 15, jobKind: 'workflow_understand' } as any,
      { kind: 'platform', minCredits: 134, jobKind: 'workflow_text_to_image' } as any,
    ]);
    expect(total).toBe(149);
    expect(getCreditsProxyRequestHeaders).toHaveBeenCalledTimes(1);
    expect(getCreditsProxyRequestHeaders).toHaveBeenCalledWith(149);
    const headers = getEnvelopeProxyAdmissionHeaders(15);
    expect(headers?.['X-AC-Credits-Reserve']).toBe('proxy:test-149');
    expect(getEnvelopeProxyAdmissionHeaders(134)?.['X-AC-Credits-Reserve']).toBe('proxy:test-149');
    endAiTaskEnvelope('task-credits');
  });

  it('finalize releases reserve on failed outcome', async () => {
    beginAiTaskEnvelope('task-fail');
    await prepareAiTaskEnvelopeCredits([
      { kind: 'platform', minCredits: 134, jobKind: 'workflow_text_to_image' } as any,
    ]);
    await finalizeAiTaskEnvelopeCredits('failed');
    expect(releaseCreditsProxyReserve).toHaveBeenCalledTimes(1);
    endAiTaskEnvelope('task-fail');
  });

  it('finalize success clears reserve cache without release', async () => {
    beginAiTaskEnvelope('task-ok');
    await prepareAiTaskEnvelopeCredits([
      { kind: 'platform', minCredits: 134, jobKind: 'workflow_text_to_image' } as any,
    ]);
    await finalizeAiTaskEnvelopeCredits('success');
    expect(releaseCreditsProxyReserve).not.toHaveBeenCalled();
    expect(clearLastCreditsReserveKey).toHaveBeenCalled();
    endAiTaskEnvelope('task-ok');
  });
});
