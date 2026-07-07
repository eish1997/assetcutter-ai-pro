import { describe, expect, it } from 'vitest';
import { HttpRequestError } from '../services/httpClient';
import {
  CREDITS_EXCEEDED_CODE,
  creditsExceededUserMessage,
  fmtCredits,
  fmtCreditsSidebar,
  isCreditsExceededError,
  proxyGateMinCreditsForJob,
  proxyGateJobKindForWorkflowBranch,
} from '../shared/credits';

describe('credits gate helpers', () => {
  it('proxyGateMinCreditsForJob scales by workflow kind (catalog-aligned)', () => {
    expect(proxyGateMinCreditsForJob('workflow_chat')).toBe(10);
    expect(proxyGateMinCreditsForJob('workflow_text_to_image')).toBe(134);
    expect(proxyGateMinCreditsForJob('workflow_generate_3d')).toBe(800);
    expect(proxyGateMinCreditsForJob('workflow_generate_video')).toBe(250);
    expect(proxyGateMinCreditsForJob('unknown')).toBe(1);
  });

  it('proxyGateJobKindForWorkflowBranch maps runTask branches', () => {
    expect(proxyGateJobKindForWorkflowBranch('branch_generate_3d')).toBe('workflow_generate_3d');
    expect(
      proxyGateJobKindForWorkflowBranch('branch_preset_execute_capability', { category: 'generate_video' })
    ).toBe('workflow_generate_video');
    expect(
      proxyGateJobKindForWorkflowBranch('branch_preset_execute_capability', { category: 'text_to_image' })
    ).toBe('workflow_text_to_image');
    expect(
      proxyGateJobKindForWorkflowBranch('branch_preset_execute_capability', { category: 'image_to_image' })
    ).toBe('workflow_text_to_image');
    expect(proxyGateJobKindForWorkflowBranch('branch_capability_set')).toBe('workflow_text_to_image');
  });

  it('isCreditsExceededError detects code and message', () => {
    expect(isCreditsExceededError(new HttpRequestError('积分不足', 403, CREDITS_EXCEEDED_CODE))).toBe(true);
    expect(isCreditsExceededError(new Error('积分不足，请联系管理员'))).toBe(true);
    expect(isCreditsExceededError(new Error('network fail'))).toBe(false);
  });

  it('creditsExceededUserMessage mentions settings', () => {
    expect(creditsExceededUserMessage()).toContain('设置');
    expect(creditsExceededUserMessage(10, 25)).toContain('还差');
  });

  it('fmtCreditsSidebar compacts for narrow sidebar', () => {
    expect(fmtCreditsSidebar(999)).toBe('999');
    expect(fmtCreditsSidebar(1234)).toBe('1234');
    expect(fmtCreditsSidebar(99999)).toBe('10万');
    expect(fmtCreditsSidebar(15000)).toBe('1.5万');
  });
});
