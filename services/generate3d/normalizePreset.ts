import type { Generate3DPreset } from '../../types';

/** 工作流 / Tripo 提交前规范化预设，避免无效参数 */
export function normalizeGenerate3DPresetForRun(input: Generate3DPreset): Generate3DPreset {
  const g = { ...input };
  if (g.module !== 'pro' && g.module !== 'rapid') g.module = 'pro';
  if (g.module === 'pro') {
    if (g.model !== '3.0' && g.model !== '3.1') g.model = '3.0';
    if (g.generateType !== 'Normal' && g.generateType !== 'LowPoly' && g.generateType !== 'Geometry' && g.generateType !== 'Sketch') {
      g.generateType = 'Normal';
    }
    if (g.polygonType !== 'triangle' && g.polygonType !== 'quadrilateral') {
      g.polygonType = undefined;
    }
    if (typeof g.faceCount === 'number' && !Number.isNaN(g.faceCount)) {
      const n = Math.floor(g.faceCount);
      const min = g.generateType === 'LowPoly' ? 3000 : 10000;
      g.faceCount = Math.max(min, Math.min(1500000, n));
    } else {
      g.faceCount = undefined;
    }
    const proFormats = new Set(['STL', 'USDZ', 'FBX']);
    if (g.resultFormat && !proFormats.has(g.resultFormat)) g.resultFormat = undefined;
  } else {
    g.model = undefined;
    g.faceCount = undefined;
    g.generateType = undefined;
    g.polygonType = undefined;
    const rapidFormats = new Set(['OBJ', 'GLB', 'STL', 'USDZ', 'FBX', 'MP4']);
    if (g.resultFormat && !rapidFormats.has(g.resultFormat)) g.resultFormat = undefined;
  }
  return g;
}
