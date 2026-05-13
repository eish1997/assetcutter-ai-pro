export type HeightfieldCavityOpts = {
  /** 凹腔相对高度幅度的权重，越大凹槽越暗、浮雕越「抠」得出来 */
  strength?: number;
  /** 乘色系数下限，避免死黑 */
  floor?: number;
};

/**
 * 对 `PlaneGeometry(width, height, segX, segY)` 按行优先（ix 快、iy 慢）顶点顺序，
 * 用邻域平均高度与当前高度差估计「凹下去」的程度，得到 0–1 明暗因子（偏屏幕空间廉价 AO）。
 */
export function buildPlaneHeightCavityFactors(
  segX: number,
  segY: number,
  heightZ: Float32Array,
  opts?: HeightfieldCavityOpts
): Float32Array {
  const vx = Math.max(2, segX + 1);
  const vy = Math.max(2, segY + 1);
  const n = vx * vy;
  if (heightZ.length !== n) {
    throw new Error(`heightZ length ${heightZ.length} !== grid ${vx}×${vy} (${n})`);
  }
  const strength = opts?.strength ?? 1.12;
  const floor = opts?.floor ?? 0.32;
  let zMin = heightZ[0] ?? 0;
  let zMax = zMin;
  for (let i = 1; i < n; i++) {
    const z = heightZ[i] ?? 0;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const span = Math.max(zMax - zMin, 1e-9);
  const out = new Float32Array(n);
  for (let iy = 0; iy < vy; iy++) {
    for (let ix = 0; ix < vx; ix++) {
      const i = ix + iy * vx;
      const z0 = heightZ[i] ?? 0;
      let sum = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = ix + dx;
          const ny = iy + dy;
          if (nx < 0 || nx >= vx || ny < 0 || ny >= vy) continue;
          sum += heightZ[nx + ny * vx] ?? 0;
          cnt++;
        }
      }
      const avg = cnt ? sum / cnt : z0;
      const recess = Math.max(0, (avg - z0) / span);
      const raw = 1 - recess * strength;
      out[i] = raw < floor ? floor : raw > 1 ? 1 : raw;
    }
  }
  return out;
}

/** 灰度因子 → `BufferGeometry` 用 `color` 属性（每顶点 RGB 相同） */
export function cavityFactorsToVertexColorBuffer(factors: Float32Array): Float32Array {
  const out = new Float32Array(factors.length * 3);
  for (let i = 0; i < factors.length; i++) {
    const g = factors[i] ?? 1;
    const o = i * 3;
    out[o] = g;
    out[o + 1] = g;
    out[o + 2] = g;
  }
  return out;
}
