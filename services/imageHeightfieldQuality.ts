/**
 * 高度 3D 预览：画质 ↔ 性能（位移贴图边长、网格顶点预算、渲染像素比）。
 * `quality01`：0 偏性能，1 偏画质。
 */
export type HeightfieldQualitySettings = {
  displaceMaxEdge: number;
  maxPlaneCells: number;
  pixelRatioCap: number;
};

export function getHeightfieldQualitySettings(quality01: number): HeightfieldQualitySettings {
  const t = Math.max(0, Math.min(1, quality01));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    displaceMaxEdge: Math.round(lerp(768, 2048)),
    maxPlaneCells: Math.round(lerp(130_000, 380_000)),
    pixelRatioCap: Math.round(lerp(1.1, 2) * 100) / 100,
  };
}
