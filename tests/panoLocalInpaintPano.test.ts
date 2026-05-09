import { describe, expect, it } from 'vitest';
import { computePanoCompositeUpscaleFactor } from '../services/panoLocalInpaintPano';

describe('computePanoCompositeUpscaleFactor', () => {
  it('returns 1 when patch matches expanded and footprint matches expanded', () => {
    expect(computePanoCompositeUpscaleFactor(1024, 512, 400, 300, 400, 300, 400, 300)).toBe(1);
  });

  it('scales up when patch is larger than expanded rect', () => {
    expect(computePanoCompositeUpscaleFactor(1024, 512, 400, 300, 1600, 1200, 400, 300)).toBe(4);
  });

  it('scales up when patch equals expanded but footprint on equirect is smaller (typical 1k base + HD viewport)', () => {
    expect(computePanoCompositeUpscaleFactor(1024, 512, 800, 600, 800, 600, 200, 150)).toBe(4);
  });

  it('respects max upscale cap', () => {
    const f = computePanoCompositeUpscaleFactor(1024, 512, 100, 100, 9999, 9999, 1, 1);
    expect(f).toBeLessThanOrEqual(8);
  });
});
