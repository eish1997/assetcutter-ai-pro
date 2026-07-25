import type { Generate3DPreset } from '../../types';
import type { Generate3dProviderId } from './types';

export function resolveGenerate3dProviderId(g: Generate3DPreset): Generate3dProviderId {
  if (g.provider === 'volcengine-ark') return 'volcengine-ark';
  return g.provider === 'tencent' ? 'tencent' : 'tripo';
}

/** C9: Hunyuan user path always targets Gateway registry ids (not VITE_TENCENT_PROXY). */
export function resolveTencentHunyuanRegistryId(g: Generate3DPreset): string {
  const fromPreset = String(g.modelRegistryId || '').trim();
  if (fromPreset.startsWith('tencent-hunyuan')) return fromPreset;
  return g.module === 'rapid' ? 'tencent-hunyuan-3d-rapid' : 'tencent-hunyuan-3d-pro';
}
