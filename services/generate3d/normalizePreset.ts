import type { Generate3DPreset } from '../../types';

/** 工作流 / Tripo 提交前规范化预设，避免无效参数 */
export function normalizeGenerate3DPresetForRun(input: Generate3DPreset): Generate3DPreset {
  const g = { ...input };
  if (g.module !== 'pro' && g.module !== 'rapid') g.module = 'pro';
  const allowed = new Set(['STL', 'USDZ', 'FBX']);
  if (g.resultFormat && !allowed.has(g.resultFormat)) g.resultFormat = undefined;
  if (g.module === 'pro') {
    if (g.model !== '3.0' && g.model !== '3.1') g.model = '3.0';
    if (typeof g.faceCount === 'number' && !Number.isNaN(g.faceCount)) {
      const n = Math.floor(g.faceCount);
      g.faceCount = Math.max(10000, Math.min(1500000, n));
    } else {
      g.faceCount = undefined;
    }
  } else {
    g.model = undefined;
    g.faceCount = undefined;
    g.generateType = undefined;
  }
  return g;
}
