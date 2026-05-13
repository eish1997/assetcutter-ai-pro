import { describe, expect, it } from 'vitest';
import {
  clampHeightfieldPlaneSegments,
  rgbToHeightLuminance,
  sampleGrayDispBilinear,
  sampleHeightBilinear,
} from '../services/imageHeightfieldLuminance';

describe('imageHeightfieldLuminance', () => {
  it('rgbToHeightLuminance matches standard luma weights', () => {
    expect(rgbToHeightLuminance(255, 255, 255)).toBeCloseTo(1, 5);
    expect(rgbToHeightLuminance(0, 0, 0)).toBeCloseTo(0, 5);
    expect(rgbToHeightLuminance(255, 0, 0)).toBeCloseTo(0.299, 3);
    expect(rgbToHeightLuminance(0, 255, 0)).toBeCloseTo(0.587, 3);
    expect(rgbToHeightLuminance(0, 0, 255)).toBeCloseTo(0.114, 3);
  });

  it('sampleHeightBilinear interpolates between four corners', () => {
    const buf = new Uint8ClampedArray(2 * 2 * 4);
    buf[0] = 0;
    buf[1] = 0;
    buf[2] = 0;
    buf[3] = 255;
    buf[4] = 255;
    buf[5] = 255;
    buf[6] = 255;
    buf[7] = 255;
    buf[8] = 255;
    buf[9] = 0;
    buf[10] = 0;
    buf[11] = 255;
    buf[12] = 0;
    buf[13] = 255;
    buf[14] = 0;
    buf[15] = 255;
    const mid = sampleHeightBilinear(buf, 2, 2, 0.5, 0.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('sampleGrayDispBilinear matches corners (Plane UV v=1 top)', () => {
    const data = new Uint8ClampedArray(2 * 2 * 4);
    data[0] = 0;
    data[1] = 0;
    data[2] = 0;
    data[3] = 255;
    data[4] = 255;
    data[5] = 255;
    data[6] = 255;
    data[7] = 255;
    data[8] = 128;
    data[9] = 128;
    data[10] = 128;
    data[11] = 255;
    data[12] = 255;
    data[13] = 0;
    data[14] = 0;
    data[15] = 255;
    const img = { data, w: 2, h: 2 };
    expect(sampleGrayDispBilinear(img, 0, 1)).toBeCloseTo(0, 5);
    expect(sampleGrayDispBilinear(img, 1, 1)).toBeCloseTo(1, 5);
    expect(sampleGrayDispBilinear(img, 0, 0)).toBeCloseTo(128 / 255, 5);
  });

  it('clampHeightfieldPlaneSegments caps total cells', () => {
    const a = clampHeightfieldPlaneSegments(2048, 2048);
    expect(a.segX * a.segY).toBeLessThanOrEqual(380_000);
    expect(a.segX).toBeGreaterThanOrEqual(96);
    expect(a.segY).toBeGreaterThanOrEqual(96);
  });

  it('clampHeightfieldPlaneSegments respects custom maxCells', () => {
    const a = clampHeightfieldPlaneSegments(2048, 2048, 100_000);
    expect(a.segX * a.segY).toBeLessThanOrEqual(100_000);
  });
});
