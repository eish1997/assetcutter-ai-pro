import type { Generate3dProviderId } from './types';

/** 人类可读名，供日志 / 后续 UI 使用 */
export const GENERATE3D_PROVIDER_REGISTRY: Record<Generate3dProviderId, { label: string }> = {
  tencent: { label: '腾讯混元生3D' },
  tripo: { label: 'Tripo' },
  'volcengine-ark': { label: 'Volcengine Ark Seed3D' },
};

export function listRegisteredGenerate3dProviderIds(): Generate3dProviderId[] {
  return Object.keys(GENERATE3D_PROVIDER_REGISTRY) as Generate3dProviderId[];
}
