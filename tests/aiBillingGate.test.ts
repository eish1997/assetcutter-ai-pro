import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREDITS_EXCEEDED_CODE, LOGIN_REQUIRED_CODE } from '../shared/credits';
import { HttpRequestError } from '../services/httpClient';
import type { CustomAppModule } from '../types';

vi.mock('../services/geminiFairnessBridge', () => ({
  getGeminiFairnessUserId: vi.fn(() => null),
}));

vi.mock('../services/creditsApi', () => ({
  assertCreditBalanceAtLeast: vi.fn(),
  prechargePlatformCredits: vi.fn(),
  fetchCreditBalance: vi.fn(),
  releaseCreditReserve: vi.fn(),
}));

vi.mock('../services/settingsStore', () => ({
  getEnabledChannels: vi.fn(() => ['vertex-proxy']),
  isChannelReady: vi.fn(() => true),
  getTencentCreds: vi.fn(() => ({ secretId: '', secretKey: '' })),
  getUserApiKey: vi.fn(() => null),
  getTripoApiKey: vi.fn(() => null),
}));

vi.mock('../services/platformAiPath', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/platformAiPath')>();
  return {
    ...actual,
    isPlatformMeteredGeminiPath: vi.fn(actual.isPlatformMeteredGeminiPath),
    isPlatformMeteredJobKind: vi.fn(actual.isPlatformMeteredJobKind),
  };
});

vi.mock('../services/creditsPrechargeSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/creditsPrechargeSession')>();
  return {
    ...actual,
    peekCreditsPrechargeSession: vi.fn(() => null),
    creditsPrechargeCoversJobKind: vi.fn(() => false),
  };
});

import { getGeminiFairnessUserId } from '../services/geminiFairnessBridge';
import { prechargePlatformCredits } from '../services/creditsApi';
import { getTencentCreds } from '../services/settingsStore';
import { isPlatformMeteredGeminiPath } from '../services/platformAiPath';
import {
  assertAiGateForSteps,
  isSubmitBlockedForPlatformPlan,
  planCapabilityModuleRoutes,
  planWorkflowActionRoutes,
  planQuickComposeRoutes,
  requiresPlatformCredits,
  resolveJobKindBillingStep,
  resolveRegistryBillingStep,
  sumPlatformMinCredits,
  maxPlatformStepMinCredits,
  fmtPlanStepsBreakdown,
  fmtCreditsEstimateFooter,
} from '../services/aiBillingGate';
import { creditsExceededUserMessage } from '../shared/credits';

describe('aiBillingGate', () => {
  beforeEach(async () => {
    vi.mocked(getGeminiFairnessUserId).mockReturnValue(null);
    vi.mocked(prechargePlatformCredits).mockReset();
    vi.mocked(getTencentCreds).mockReturnValue({ secretId: '', secretKey: '' });
    vi.mocked(isPlatformMeteredGeminiPath).mockImplementation((id, role) => {
      if (role === 'image' && id === 'gpt-image-2') return false;
      return true;
    });
  });

  it('resolveRegistryBillingStep marks BYOK when not platform metered', () => {
    const step = resolveRegistryBillingStep({
      registryId: 'gpt-image-2',
      role: 'image',
      jobKind: 'workflow_text_to_image',
    });
    expect(step.kind).toBe('byok');
    expect(step.minCredits).toBe(0);
  });

  it('resolveRegistryBillingStep assigns platform minCredits', () => {
    const step = resolveRegistryBillingStep({
      registryId: 'gemini-3-pro-image',
      role: 'image',
      jobKind: 'workflow_text_to_image',
    });
    expect(step.kind).toBe('platform');
    expect(step.minCredits).toBeGreaterThan(0);
  });

  it('resolveJobKindBillingStep exempts tencent-backed 3d', () => {
    vi.mocked(getTencentCreds).mockReturnValue({ secretId: 'sid', secretKey: 'skey' });
    const step = resolveJobKindBillingStep('workflow_generate_3d');
    expect(step.kind).toBe('exempt');
  });

  it('workflow Tripo 3D presets stay platform metered even when an old local key exists', () => {
    vi.mocked(getTencentCreds).mockReturnValue({ secretId: 'sid', secretKey: 'skey' });
    const steps = planWorkflowActionRoutes(
      'tripo_3d',
      {
        id: 'tripo_3d',
        label: 'Tripo 3D',
        category: 'generate_3d',
        generate3D: { provider: 'tripo', modelRegistryId: 'tripo-p1' },
      } as CustomAppModule
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe('platform');
    expect(steps[0]?.jobKind).toBe('workflow_generate_3d');
  });

  it('planCapabilityModuleRoutes adds understand step for gen_image', () => {
    const steps = planCapabilityModuleRoutes({
      id: 'variant',
      label: '变体',
      category: 'image_to_image',
      engine: 'gen_image',
      instruction: 'test',
      imageModelRegistryId: 'gemini-3-pro-image',
    });
    expect(steps).toHaveLength(2);
    expect(steps.some((s) => s.jobKind === 'workflow_understand')).toBe(true);
    expect(sumPlatformMinCredits(steps)).toBeGreaterThan(0);
  });

  it('planCapabilityModuleRoutes skips understand when overrideSkipUnderstand', () => {
    vi.mocked(isPlatformMeteredGeminiPath).mockReturnValue(false);
    const steps = planCapabilityModuleRoutes(
      {
        id: 'variant',
        label: '变体',
        category: 'image_to_image',
        engine: 'gen_image',
        instruction: 'test',
      },
      { overrideSkipUnderstand: true }
    );
    expect(steps).toHaveLength(1);
    expect(requiresPlatformCredits(steps)).toBe(false);
  });

  it('fmtPlanStepsBreakdown labels platform and byok steps', () => {
    vi.mocked(isPlatformMeteredGeminiPath).mockImplementation((id, role) => {
      if (role === 'image' && id === 'gpt-image-2') return false;
      return true;
    });
    const steps = planCapabilityModuleRoutes({
      id: 'variant',
      label: '变体',
      category: 'image_to_image',
      engine: 'gen_image',
      instruction: 'test',
      textModelRegistryId: 'gemini-3-flash',
      imageModelRegistryId: 'gpt-image-2',
    });
    const lines = fmtPlanStepsBreakdown(steps);
    expect(lines.some((l) => l.includes('理解') && l.includes('积分'))).toBe(true);
    expect(lines.some((l) => l.includes('生图') && l.includes('自备 Key'))).toBe(true);
  });

  it('fmtCreditsEstimateFooter computes shortfall against balance', () => {
    const steps = planCapabilityModuleRoutes({
      id: 't2i',
      label: '文生图',
      category: 'text_to_image',
      engine: 'gen_text',
      instruction: 'test',
    });
    const min = sumPlatformMinCredits(steps);
    const ok = fmtCreditsEstimateFooter(steps, min);
    expect(ok.totalMin).toBe(min);
    expect(ok.shortfall).toBe(0);
    expect(ok.lines.length).toBeGreaterThan(0);

    const low = fmtCreditsEstimateFooter(steps, Math.max(0, min - 5));
    expect(low.shortfall).toBeGreaterThan(0);
  });

  it('creditsExceededUserMessage includes shortfall when amounts known', () => {
    expect(creditsExceededUserMessage(40, 50)).toContain('还差');
    expect(creditsExceededUserMessage(40, 50)).toContain('10');
  });

  it('isSubmitBlockedForPlatformPlan reason includes shortfall', () => {
    const steps = planCapabilityModuleRoutes({
      id: 't2i',
      label: '文生图',
      category: 'text_to_image',
      engine: 'gen_text',
      instruction: 'test',
    });
    const min = sumPlatformMinCredits(steps);
    const block = isSubmitBlockedForPlatformPlan(steps, 'u1', min - 3, false);
    expect(block.blocked).toBe(true);
    expect(block.reason).toContain('还差');
  });

  it('planQuickComposeRoutes empty cards respects BYOK image model', () => {
    vi.mocked(isPlatformMeteredGeminiPath).mockImplementation((id, role) => {
      if (role === 'image' && id === 'gpt-image-2') return false;
      return true;
    });
    const steps = planQuickComposeRoutes({
      mode: 'image',
      promptCards: [],
      resolveModule: () => null,
      imageModelRegistryId: 'gpt-image-2',
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe('byok');
    expect(requiresPlatformCredits(steps)).toBe(false);
  });

  it('planQuickComposeRoutes image mode adds understand when overrideSkipUnderstand false', () => {
    const steps = planQuickComposeRoutes({
      mode: 'image',
      promptCards: [],
      resolveModule: () => null,
      imageModelRegistryId: 'gemini-3-pro-image',
      textModelRegistryId: 'gemini-3-flash',
      overrides: { overrideSkipUnderstand: false },
    });
    expect(steps.some((s) => s.jobKind === 'workflow_understand')).toBe(true);
    expect(steps.some((s) => s.jobKind === 'workflow_text_to_image')).toBe(true);
    expect(steps).toHaveLength(2);
  });

  it('planQuickComposeRoutes empty cards respects BYOK text model', () => {
    vi.mocked(isPlatformMeteredGeminiPath).mockReturnValue(false);
    const steps = planQuickComposeRoutes({
      mode: 'text',
      promptCards: [],
      resolveModule: () => null,
      textModelRegistryId: 'gpt-4o',
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe('byok');
    expect(requiresPlatformCredits(steps)).toBe(false);
  });

  it('assertAiGateForSteps blocks when not logged in', async () => {
    const steps = planCapabilityModuleRoutes({
      id: 't2i',
      label: '文生图',
      category: 'text_to_image',
      engine: 'gen_image',
      instruction: 'test',
    });
    await expect(assertAiGateForSteps(steps)).rejects.toMatchObject({
      code: LOGIN_REQUIRED_CODE,
    });
  });

  it('assertAiGateForSteps precharges platform steps when logged in', async () => {
    vi.mocked(getGeminiFairnessUserId).mockReturnValue('u1');
    vi.mocked(prechargePlatformCredits).mockResolvedValue({
      prechargeKey: 'pc:1',
      reserveKey: 'pc:1',
      amount: 134,
      remaining: 134,
    });
    const steps = [
      resolveRegistryBillingStep({
        registryId: 'gemini-3-pro-image',
        role: 'image',
        jobKind: 'workflow_text_to_image',
      }),
    ];
    await assertAiGateForSteps(steps, { userId: 'u1', scopeKey: 'scope-1' });
    expect(prechargePlatformCredits).toHaveBeenCalledWith(steps[0]!.minCredits, 'scope-1');
  });

  it('maxPlatformStepMinCredits uses max platform step not sum', () => {
    const withUnderstand = planCapabilityModuleRoutes({
      id: 'variant',
      label: '变体',
      category: 'image_to_image',
      engine: 'gen_image',
      instruction: 'test',
      skipUnderstand: false,
    });
    expect(sumPlatformMinCredits(withUnderstand)).toBeGreaterThan(maxPlatformStepMinCredits(withUnderstand));
    expect(maxPlatformStepMinCredits(withUnderstand)).toBe(
      Math.max(...withUnderstand.filter((s) => s.kind === 'platform').map((s) => s.minCredits))
    );
  });

  it('isSubmitBlockedForPlatformPlan honors minCreditsOverride', () => {
    const steps = planCapabilityModuleRoutes({
      id: 't2i',
      label: '文生图',
      category: 'text_to_image',
      engine: 'gen_text',
      instruction: 'test',
    });
    const clientMin = sumPlatformMinCredits(steps);
    const block = isSubmitBlockedForPlatformPlan(steps, 'u1', clientMin - 1, false, {
      minCreditsOverride: clientMin + 50,
    });
    expect(block.blocked).toBe(true);
    expect(block.estimatedMinCredits).toBe(clientMin + 50);
  });

  it('isSubmitBlockedForPlatformPlan requires login and sufficient balance', () => {
    const steps = planCapabilityModuleRoutes({
      id: 't2i',
      label: '文生图',
      category: 'text_to_image',
      engine: 'gen_text',
      instruction: 'test',
    });
    const min = sumPlatformMinCredits(steps);
    expect(isSubmitBlockedForPlatformPlan(steps, null, 0, false).blocked).toBe(true);
    expect(isSubmitBlockedForPlatformPlan(steps, 'u1', min - 1, false).blocked).toBe(true);
    expect(isSubmitBlockedForPlatformPlan(steps, 'u1', min, false).blocked).toBe(false);
  });

  it('isSubmitBlockedForPlatformPlan does not block while loading if balance already known', () => {
    const steps = planCapabilityModuleRoutes({
      id: 't2i',
      label: '文生图',
      category: 'text_to_image',
      engine: 'gen_text',
      instruction: 'test',
    });
    const min = sumPlatformMinCredits(steps);
    expect(isSubmitBlockedForPlatformPlan(steps, 'u1', min + 100, true).blocked).toBe(false);
    expect(isSubmitBlockedForPlatformPlan(steps, 'u1', null, true).blocked).toBe(true);
  });

  it('assertAiGateForSteps no-ops for BYOK-only plans', async () => {
    vi.mocked(isPlatformMeteredGeminiPath).mockReturnValue(false);
    const steps = planCapabilityModuleRoutes({
      id: 'variant',
      label: '变体',
      category: 'image_to_image',
      engine: 'gen_image',
      instruction: 'test',
    });
    await assertAiGateForSteps(steps);
    expect(prechargePlatformCredits).not.toHaveBeenCalled();
  });

  it('assertAiGateForSteps rejects zero balance precharge', async () => {
    vi.mocked(getGeminiFairnessUserId).mockReturnValue('u1');
    vi.mocked(prechargePlatformCredits).mockRejectedValue(
      new HttpRequestError('积分不足', 403, CREDITS_EXCEEDED_CODE)
    );
    const steps = [
      resolveRegistryBillingStep({
        registryId: 'gemini-3-pro-image',
        role: 'image',
        jobKind: 'workflow_text_to_image',
      }),
    ];
    await expect(assertAiGateForSteps(steps, { userId: 'u1' })).rejects.toMatchObject({
      code: CREDITS_EXCEEDED_CODE,
    });
  });
});
