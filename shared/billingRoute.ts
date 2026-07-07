/**
 * 统一积分路由决策（前后端同逻辑单源）。
 * @see docs/adr/统一派发积分闸门-v2.md
 */
import { proxyGateMinCreditsForJob } from './credits';

export type BillingRouteKind = 'platform' | 'byok' | 'exempt';

export type BillingRouteDecision = {
  routeKind: BillingRouteKind;
  minCredits: number;
  channel?: string;
};

export type ResolveBillingRouteInput = {
  jobKind: string;
  registryId?: string;
  role?: 'text' | 'image';
  /** pickBinding 解析出的 channel */
  channel?: string;
  /** @deprecated 与 channel 等价，测试兼容 */
  bindingChannel?: string;
  generate3dProvider?: 'tripo' | 'tencent';
  hasTripoApiKey?: boolean;
  hasTencentCreds?: boolean;
  hasUserApiKey?: boolean;
  platformSiteProxyConfigured?: boolean;
};

const PLATFORM_PROXY_CHANNELS = new Set(['vertex-proxy']);

const BYOK_CHANNELS = new Set([
  'gemini-aistudio',
  'toapis-gemini',
  'toapis-openai',
  'vectorengine',
  'openai-official',
]);

const ALWAYS_PLATFORM_JOB_KINDS = new Set([
  'workflow_jimeng_image',
  'workflow_jimeng_video',
  'workflow_jimeng_digital_human',
  'workflow_generate_video',
]);

const PLATFORM_JOB_KINDS = new Set([
  'workflow_chat',
  'workflow_understand',
  'workflow_text_to_image',
  'workflow_image_edit',
  'workflow_generate_3d',
  ...ALWAYS_PLATFORM_JOB_KINDS,
]);

function minForPlatformJob(jobKind: string): number {
  return Math.max(1, proxyGateMinCreditsForJob(jobKind));
}

function resolvedChannel(input: ResolveBillingRouteInput): string {
  return String(input.channel || input.bindingChannel || '').trim();
}

function routeFromChannel(channel: string, jobKind: string): BillingRouteDecision {
  if (PLATFORM_PROXY_CHANNELS.has(channel)) {
    return { routeKind: 'platform', minCredits: minForPlatformJob(jobKind), channel };
  }
  if (BYOK_CHANNELS.has(channel)) {
    return { routeKind: 'byok', minCredits: 0, channel };
  }
  return { routeKind: 'byok', minCredits: 0, channel };
}

function routeForGenerate3d(jobKind: string, input: ResolveBillingRouteInput): BillingRouteDecision | null {
  if (jobKind !== 'workflow_generate_3d') return null;

  const provider = input.generate3dProvider;
  if (provider === 'tripo' && input.hasTripoApiKey) {
    return { routeKind: 'byok', minCredits: 0 };
  }
  if (provider === 'tencent' && input.hasTencentCreds) {
    return { routeKind: 'byok', minCredits: 0 };
  }
  if (!provider && (input.hasTripoApiKey || input.hasTencentCreds)) {
    return { routeKind: 'byok', minCredits: 0 };
  }
  return { routeKind: 'platform', minCredits: minForPlatformJob(jobKind) };
}

/** 唯一规则源：binding → registry 回退 → 即梦/生视频 → 3D BYOK → 其余 platform jobKind */
export function resolveBillingRoute(input: ResolveBillingRouteInput): BillingRouteDecision {
  const jobKind = String(input.jobKind || 'workflow_chat').trim() || 'workflow_chat';
  const channel = resolvedChannel(input);

  if (channel) {
    return routeFromChannel(channel, jobKind);
  }

  if (String(input.registryId || '').trim()) {
    if (input.hasUserApiKey) return { routeKind: 'byok', minCredits: 0 };
    if (input.platformSiteProxyConfigured) {
      return { routeKind: 'platform', minCredits: minForPlatformJob(jobKind) };
    }
    return { routeKind: 'byok', minCredits: 0 };
  }

  if (ALWAYS_PLATFORM_JOB_KINDS.has(jobKind)) {
    return { routeKind: 'platform', minCredits: minForPlatformJob(jobKind) };
  }

  const generate3d = routeForGenerate3d(jobKind, input);
  if (generate3d) return generate3d;

  if (PLATFORM_JOB_KINDS.has(jobKind)) {
    return { routeKind: 'platform', minCredits: minForPlatformJob(jobKind) };
  }

  return { routeKind: 'exempt', minCredits: 0 };
}

export function isPlatformMeteredGeminiRoute(input: {
  registryId: string;
  role?: 'text' | 'image';
  channel?: string;
  bindingChannel?: string;
  hasUserApiKey?: boolean;
  platformSiteProxyConfigured?: boolean;
}): boolean {
  return (
    resolveBillingRoute({
      jobKind: 'workflow_chat',
      registryId: input.registryId,
      role: input.role ?? 'text',
      channel: input.channel || input.bindingChannel,
      hasUserApiKey: input.hasUserApiKey,
      platformSiteProxyConfigured: input.platformSiteProxyConfigured,
    }).routeKind === 'platform'
  );
}

export function isPlatformMeteredJobKindRoute(input: {
  jobKind: string;
  generate3dProvider?: 'tripo' | 'tencent';
  hasTripoApiKey?: boolean;
  hasTencentCreds?: boolean;
}): boolean {
  return (
    resolveBillingRoute({
      jobKind: input.jobKind,
      generate3dProvider: input.generate3dProvider,
      hasTripoApiKey: input.hasTripoApiKey,
      hasTencentCreds: input.hasTencentCreds,
    }).routeKind === 'platform'
  );
}

export function isByokBindingChannel(channel: string | null | undefined): boolean {
  const ch = String(channel || '').trim();
  if (!ch) return false;
  if (PLATFORM_PROXY_CHANNELS.has(ch)) return false;
  return BYOK_CHANNELS.has(ch);
}

export function minCreditsForBillingRoute(jobKind: string, routeKind: BillingRouteKind): number {
  return routeKind === 'platform' ? minForPlatformJob(jobKind) : 0;
}
