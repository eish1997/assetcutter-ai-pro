import type { Generate3DPreset } from '../../types';
import type { Generate3dProviderId } from './types';

export function resolveGenerate3dProviderId(g: Generate3DPreset): Generate3dProviderId {
  if (g.provider === 'volcengine-ark') return 'volcengine-ark';
  return g.provider === 'tencent' ? 'tencent' : 'tripo';
}
