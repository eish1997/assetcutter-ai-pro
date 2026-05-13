import { describe, expect, it } from 'vitest';
import {
  buildPlaneHeightCavityFactors,
  cavityFactorsToVertexColorBuffer,
} from '../services/imageHeightfieldVertexCavity';

describe('imageHeightfieldVertexCavity', () => {
  it('pit center is darker than rim (3×3)', () => {
    const segX = 2;
    const segY = 2;
    const n = 9;
    const z = new Float32Array(n);
    z.fill(0.5);
    z[4] = 0;
    const f = buildPlaneHeightCavityFactors(segX, segY, z, { strength: 2, floor: 0.1 });
    expect(f[4]).toBeLessThan(f[0]);
    expect(f[4]).toBeLessThan(0.99);
  });

  it('cavityFactorsToVertexColorBuffer packs RGB', () => {
    const f = new Float32Array([0.5, 1]);
    const buf = cavityFactorsToVertexColorBuffer(f);
    expect(buf.length).toBe(6);
    expect(buf[0]).toBe(0.5);
    expect(buf[1]).toBe(0.5);
    expect(buf[2]).toBe(0.5);
    expect(buf[3]).toBe(1);
  });
});
