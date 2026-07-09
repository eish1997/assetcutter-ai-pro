import { describe, it, expect } from 'vitest';
import {
  formatPipelineStepProgress,
  planCapabilityPipelineSteps,
} from '../services/aiPipelineStepPlan';
import {
  overrideSkipUnderstandFromUnderstandEnabled,
  shouldRunCapabilityUnderstand,
} from '../services/workflowUnderstandOverride';

describe('overrideSkipUnderstandFromUnderstandEnabled', () => {
  it('returns undefined when not set', () => {
    expect(overrideSkipUnderstandFromUnderstandEnabled(undefined)).toBeUndefined();
  });

  it('returns true to skip when understand is off', () => {
    expect(overrideSkipUnderstandFromUnderstandEnabled(false)).toBe(true);
  });

  it('returns false to run understand when understand is on', () => {
    expect(overrideSkipUnderstandFromUnderstandEnabled(true)).toBe(false);
  });
});

describe('shouldRunCapabilityUnderstand', () => {
  it('fixed instruction always direct even when opt-in', () => {
    expect(
      shouldRunCapabilityUnderstand(
        { instruction: '白模提示词', skipUnderstand: false },
        { overrideSkipUnderstand: false }
      )
    ).toBe(false);
  });

  it('no instruction + opt-in → understand', () => {
    expect(
      shouldRunCapabilityUnderstand({ instruction: '', skipUnderstand: false }, { overrideSkipUnderstand: false })
    ).toBe(true);
  });

  it('default without opt-in → direct', () => {
    expect(shouldRunCapabilityUnderstand({ instruction: '', skipUnderstand: false }, {})).toBe(false);
  });
});

describe('aiPipelineStepPlan', () => {
  it('plans 1 step when direct send', () => {
    const steps = planCapabilityPipelineSteps(
      { category: 'image_to_image', engine: 'gen_image' },
      { runUnderstand: false }
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]?.label).toBe('生图');
  });

  it('plans 2 steps when understand enabled', () => {
    const steps = planCapabilityPipelineSteps(
      { category: 'image_to_image', engine: 'gen_image' },
      { runUnderstand: true }
    );
    expect(steps.map((s) => s.label)).toEqual(['理解', '生图']);
  });

  it('formatPipelineStepProgress prefixes step index', () => {
    expect(formatPipelineStepProgress(2, 3, '生图中')).toBe('步骤 2/3 · 生图中');
    expect(formatPipelineStepProgress(1, 1, '执行')).toBe('执行');
  });
});
