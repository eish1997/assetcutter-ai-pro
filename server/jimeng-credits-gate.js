/**
 * 即梦服务端积分 L1 预检：登录 + 余额（对齐 ai-worker-proxy credits-gate）。
 */
import { assertAiWorkerProxyCreditsGate } from './ai-worker-proxy-credits-gate.js';

/** 即梦 verified registry → L1 最低预检积分（对齐 shared/credits.ts 价目表） */
const REGISTRY_MIN_CREDITS = {
  'jimeng-image-t2i-v40': 50,
  'jimeng-video-ti2v-v30-pro': 250,
  'jimeng-dh-omnihuman-v10': 350,
};

/**
 * @param {string | null | undefined} registryId
 * @returns {number}
 */
export function estimatedCreditsForJimengRegistry(registryId) {
  const id = String(registryId || '').trim();
  if (REGISTRY_MIN_CREDITS[id] != null) return REGISTRY_MIN_CREDITS[id];
  if (id.startsWith('jimeng-video')) return 250;
  if (id.startsWith('jimeng-dh')) return 350;
  if (id.startsWith('jimeng-image')) return 50;
  return 50;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {string | null | undefined} registryId
 * @param {number | null | undefined} [explicitEstimate]
 */
export async function assertJimengCreditsGate(req, registryId, explicitEstimate) {
  const est =
    explicitEstimate != null && Number.isFinite(Number(explicitEstimate))
      ? Math.max(1, Math.floor(Number(explicitEstimate)))
      : estimatedCreditsForJimengRegistry(registryId);
  return assertAiWorkerProxyCreditsGate(req, est);
}
