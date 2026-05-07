import { describe, expect, it } from 'vitest';
import { clientPointToElementLocal, localToNaturalPoint, naturalToNorm } from '../services/imagePreviewPointerGeometry';

describe('imagePreviewPointerGeometry', () => {
  it('maps local through object-contain to norm center', () => {
    const m = {
      nw: 800,
      nh: 400,
      offsetX: 100,
      offsetY: 0,
      drawW: 400,
      drawH: 200,
    };
    const lx = m.offsetX + m.drawW / 2;
    const ly = m.offsetY + m.drawH / 2;
    const { nx, ny } = localToNaturalPoint(lx, ly, m);
    const norm = naturalToNorm(nx, ny, m);
    expect(norm.x).toBeCloseTo(0.5, 5);
    expect(norm.y).toBeCloseTo(0.5, 5);
  });

  it('clientPointToElementLocal reverses uniform scale from getBoundingClientRect', () => {
    const el = {
      clientWidth: 200,
      clientHeight: 100,
      getBoundingClientRect: () =>
        ({
          left: 10,
          top: 20,
          width: 400,
          height: 200,
        }) as DOMRect,
    } as unknown as HTMLElement;
    const p = clientPointToElementLocal(210, 120, el);
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(50, 5);
  });
});
