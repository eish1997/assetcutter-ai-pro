import { describe, it, expect } from 'vitest';
import { expandPixelBBox } from '../services/localInpaintGemini';
import { resolveDialogImageModelIdForGear } from '../services/modelRegistry/imageModels';

describe('expandPixelBBox', () => {
  it('pads by ratio and min pad, clamped to image', () => {
    const b = { x: 100, y: 100, w: 100, h: 100 };
    const e = expandPixelBBox(b, 1000, 1000, 0.18, 16);
    expect(e.x).toBeLessThanOrEqual(b.x);
    expect(e.y).toBeLessThanOrEqual(b.y);
    expect(e.w).toBeGreaterThanOrEqual(b.w);
    expect(e.h).toBeGreaterThanOrEqual(b.h);
    expect(e.x + e.w).toBeLessThanOrEqual(1000);
    expect(e.y + e.h).toBeLessThanOrEqual(1000);
  });

  it('clamps when bbox touches left/top edge', () => {
    const b = { x: 2, y: 3, w: 20, h: 20 };
    const e = expandPixelBBox(b, 100, 100, 0.5, 10);
    expect(e.x).toBe(0);
    expect(e.y).toBe(0);
    expect(e.w).toBeGreaterThan(0);
    expect(e.h).toBeGreaterThan(0);
  });
});

describe('resolveDialogImageModelIdForGear', () => {
  it('maps known gears and falls back for unknown', () => {
    const fast = resolveDialogImageModelIdForGear('fast');
    const std = resolveDialogImageModelIdForGear('standard');
    const pro = resolveDialogImageModelIdForGear('pro');
    expect(fast).toBeTruthy();
    expect(std).toBeTruthy();
    expect(pro).toBeTruthy();
    expect(resolveDialogImageModelIdForGear('bogus')).toBe(std);
  });
});
