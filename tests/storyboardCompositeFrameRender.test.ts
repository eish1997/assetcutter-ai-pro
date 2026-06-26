import { describe, expect, it } from 'vitest';
import { measureImageContainedDrawRect } from '../services/storyboardCompositeFrameRender';

describe('measureImageContainedDrawRect', () => {
  const bounds = { x: 10, y: 20, w: 200, h: 150 };

  it('fits wide image to width without cropping height', () => {
    const rect = measureImageContainedDrawRect({ width: 1600, height: 900 }, bounds);
    expect(rect.w).toBe(200);
    expect(rect.h).toBe(112.5);
    expect(rect.x).toBe(10);
    expect(rect.y).toBeCloseTo(20 + (150 - 112.5) / 2, 5);
  });

  it('fits tall image to height without cropping width', () => {
    const rect = measureImageContainedDrawRect({ width: 900, height: 1600 }, bounds);
    expect(rect.h).toBe(150);
    expect(rect.w).toBeCloseTo(150 * (900 / 1600), 5);
    expect(rect.y).toBe(20);
    expect(rect.x).toBeCloseTo(10 + (200 - rect.w) / 2, 5);
  });
});
