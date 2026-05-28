import { describe, it, expect } from 'vitest';
import {
  buildLocalInpaintGenImageOptions,
  computeCoverUpscaleDrawParams,
  expandPixelBBox,
  localInpaintPatchToDestRatio,
  planLocalInpaintComposite,
  resolveLocalInpaintExpandPadPx,
} from '../services/localInpaintGemini';
import { coerceImageModelRegistryId } from '../services/modelRegistry/imageModels';

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

  it('uses override pad when provided', () => {
    const b = { x: 50, y: 50, w: 100, h: 100 };
    const e = expandPixelBBox(b, 1000, 1000, 0.18, 16, 32);
    expect(e.x).toBe(18);
    expect(e.y).toBe(18);
    expect(e.w).toBe(164);
    expect(e.h).toBe(164);
  });
});

describe('resolveLocalInpaintExpandPadPx', () => {
  it('auto uses ratio with min pad', () => {
    expect(resolveLocalInpaintExpandPadPx(100, 'auto')).toBe(18);
    expect(resolveLocalInpaintExpandPadPx(50, 'auto')).toBe(16);
  });

  it('fixed mode returns exact px', () => {
    expect(resolveLocalInpaintExpandPadPx(1000, 64)).toBe(64);
    expect(resolveLocalInpaintExpandPadPx(1000, 0)).toBe(0);
  });
});

describe('computeCoverUpscaleDrawParams', () => {
  it('returns null when already meets min', () => {
    expect(computeCoverUpscaleDrawParams(8000, 4000, 7680, 3840)).toBeNull();
    expect(computeCoverUpscaleDrawParams(100, 100, 100, 100)).toBeNull();
  });

  it('uniform 2x when same aspect and half size', () => {
    const p = computeCoverUpscaleDrawParams(3840, 2160, 7680, 4320);
    expect(p).not.toBeNull();
    expect(p!.dw).toBeCloseTo(7680, 5);
    expect(p!.dh).toBeCloseTo(4320, 5);
    expect(p!.ox).toBeCloseTo(0, 5);
    expect(p!.oy).toBeCloseTo(0, 5);
  });

  it('uses max scale when one side is short', () => {
    const p = computeCoverUpscaleDrawParams(100, 50, 200, 200);
    expect(p).not.toBeNull();
    expect(p!.dw).toBe(400);
    expect(p!.dh).toBe(200);
    expect(p!.ox).toBe(-100);
    expect(p!.oy).toBe(0);
  });
});

describe('localInpaintPatchToDestRatio', () => {
  it('uses max axis scale', () => {
    expect(localInpaintPatchToDestRatio(4000, 4800, 200, 240)).toBeCloseTo(20, 5);
  });
});

describe('planLocalInpaintComposite', () => {
  const dest = { left: 100, top: 120, width: 200, height: 240 };

  it('fit_dest keeps canvas scale 1', () => {
    const p = planLocalInpaintComposite(10000, 10000, dest, 4000, 4800, 'fit_dest');
    expect(p.canvasScale).toBe(1);
    expect(p.pasteW).toBe(200);
    expect(p.pasteH).toBe(240);
  });

  it('upscale_canvas scales canvas by patch ratio (clamped)', () => {
    const p = planLocalInpaintComposite(10000, 10000, dest, 4000, 4800, 'upscale_canvas');
    expect(p.canvasScale).toBeGreaterThan(1);
    expect(p.pasteW).toBe(4000);
    expect(p.pasteLeft).toBe(100 * p.canvasScale);
  });

  it('detail_enhance uses sqrt scale and inset paste', () => {
    const p = planLocalInpaintComposite(2000, 2000, dest, 4000, 4800, 'detail_enhance');
    const ratio = localInpaintPatchToDestRatio(4000, 4800, 200, 240);
    expect(p.canvasScale).toBeCloseTo(Math.sqrt(ratio), 5);
    expect(p.pasteW).toBeLessThan(dest.width * p.canvasScale);
  });
});

describe('buildLocalInpaintGenImageOptions', () => {
  it('maps size and aspect', () => {
    expect(buildLocalInpaintGenImageOptions('16:9', '4K')).toEqual({
      aspectRatio: '16:9',
      imageSize: '4K',
    });
    expect(buildLocalInpaintGenImageOptions('adaptive', '')).toBeUndefined();
  });
});

describe('coerceImageModelRegistryId', () => {
  it('maps legacy gears and falls back for unknown', () => {
    const fast = coerceImageModelRegistryId('fast');
    const std = coerceImageModelRegistryId('standard');
    const pro = coerceImageModelRegistryId('pro');
    expect(fast).toBe('gemini-2.5-flash-image');
    expect(std).toBe('gemini-3.1-flash-image-preview');
    expect(pro).toBe('gemini-3-pro-image-preview');
    expect(coerceImageModelRegistryId('bogus')).toBe(std);
  });
});
