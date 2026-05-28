import { describe, it, expect } from 'vitest';
import {
  LOCAL_INPAINT_EXPAND_PRESETS,
  labelForLocalInpaintExpandMode,
} from '../services/lightboxLocalInpaintExpandPrefs';

describe('lightboxLocalInpaintExpandPrefs', () => {
  it('labels presets', () => {
    expect(labelForLocalInpaintExpandMode('auto')).toBe('自动');
    expect(labelForLocalInpaintExpandMode(64)).toBe('64');
  });

  it('has auto and fixed presets', () => {
    expect(LOCAL_INPAINT_EXPAND_PRESETS.some((p) => p.mode === 'auto')).toBe(true);
    expect(LOCAL_INPAINT_EXPAND_PRESETS.some((p) => p.mode === 0)).toBe(true);
  });
});
