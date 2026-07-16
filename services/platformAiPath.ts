/**
 * 判定当前 Gemini / 3D 调用是否走「平台代付、需扣积分」路径（BYOK 旁路 L1/L2 扣费）。
 * 规则单源：shared/billingRoute.ts
 */
import {
  isByokBindingChannel,
  isPlatformMeteredGeminiRoute,
  isPlatformMeteredJobKindRoute,
} from '../shared/billingRoute';
import type { ChannelId } from './modelRegistry/types';
import { pickBinding } from './modelRegistry/pickBinding';
import * as settingsStore from './settingsStore';

const { getTencentCreds, getUserApiKey } = settingsStore;

function platformSiteProxyConfigured(): boolean {
  try {
    const env = import.meta.env as Record<string, string | undefined>;
    return Boolean(
      String(env.VITE_AI_WORKER_PROXY_API || '').trim() ||
        String(env.VITE_AI_WORKER_PROXY_API_VERTEX || '').trim() ||
        String(env.VITE_VERTEX_FALLBACK_AI_WORKER_PROXY_API || '').trim()
    );
  } catch {
    return false;
  }
}

export function hasTencentSessionCredentials(): boolean {
  const { secretId, secretKey } = getTencentCreds();
  return Boolean(String(secretId || '').trim() && String(secretKey || '').trim());
}

function hasTripoApiKey(): boolean {
  try {
    const fn = (settingsStore as { getTripoApiKey?: () => string | null }).getTripoApiKey;
    if (typeof fn !== 'function') return false;
    return Boolean(String(fn() || '').trim());
  } catch {
    return false;
  }
}

export function isByokChannel(channel: ChannelId): boolean {
  return isByokBindingChannel(channel);
}

/** Gemini 文本/生图：当前 binding 是否需平台积分 */
export function isPlatformMeteredGeminiPath(registryId: string, role: 'text' | 'image' = 'text'): boolean {
  const id = String(registryId || '').trim();
  const picked = pickBinding(id, role);
  return isPlatformMeteredGeminiRoute({
    registryId: id,
    role,
    bindingChannel: picked?.channel,
    hasUserApiKey: Boolean(getUserApiKey()?.trim()),
    platformSiteProxyConfigured: platformSiteProxyConfigured(),
  });
}

/** 工作流 jobKind 级预检：Tripo / 腾讯自带凭证时不扣站点积分 */
export function isPlatformMeteredJobKind(jobKind: string | null | undefined): boolean {
  const k = String(jobKind || '').trim();
  return isPlatformMeteredJobKindRoute({
    jobKind: k,
    hasTripoApiKey: hasTripoApiKey(),
    hasTencentCreds: hasTencentSessionCredentials(),
  });
}
