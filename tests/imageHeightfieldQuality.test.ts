import { describe, expect, it } from 'vitest';
import { getHeightfieldQualitySettings } from '../services/imageHeightfieldQuality';

describe('imageHeightfieldQuality', () => {
  it('getHeightfieldQualitySettings endpoints', () => {
    const low = getHeightfieldQualitySettings(0);
    const high = getHeightfieldQualitySettings(1);
    expect(low.displaceMaxEdge).toBeLessThan(high.displaceMaxEdge);
    expect(low.maxPlaneCells).toBeLessThan(high.maxPlaneCells);
    expect(low.pixelRatioCap).toBeLessThanOrEqual(high.pixelRatioCap);
    expect(low.maxPlaneCells).toBeGreaterThanOrEqual(130_000);
    expect(high.maxPlaneCells).toBeLessThanOrEqual(380_000);
  });
});
