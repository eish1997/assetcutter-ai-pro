import { describe, it, expect } from 'vitest';
import { overrideSkipUnderstandFromUnderstandEnabled } from '../services/workflowUnderstandOverride';

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
