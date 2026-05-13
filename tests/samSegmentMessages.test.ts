import { describe, expect, it } from 'vitest';
import {
  humanMessageForSamSegmentFailure,
  isSamInstallHelpCode,
} from '../services/companionSamSegmentMessages';

describe('companionSamSegmentMessages', () => {
  it('maps known COMPUTE_* codes to zh-CN', () => {
    expect(humanMessageForSamSegmentFailure('COMPUTE_SAM_TIMEOUT', 'x')).toContain('中断');
    expect(humanMessageForSamSegmentFailure('COMPUTE_SAM_BACKEND', 'fetch failed')).toContain('SamLocal');
  });

  it('flags install-help codes for companion modal', () => {
    expect(isSamInstallHelpCode('COMPUTE_SAM_BACKEND')).toBe(true);
    expect(isSamInstallHelpCode('COMPUTE_SAM_MODEL_MISSING')).toBe(true);
    expect(isSamInstallHelpCode('COMPUTE_SAM_TIMEOUT')).toBe(false);
  });

  it('falls back to upstream message when code unknown', () => {
    expect(humanMessageForSamSegmentFailure(undefined, 'raw')).toBe('raw');
    expect(humanMessageForSamSegmentFailure('UNKNOWN', 'detail')).toBe('detail');
  });
});
