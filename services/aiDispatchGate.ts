/**
 * 执行层单点积分闸门：每次 upstream 前登录校验 + platform reserve。
 * @see docs/adr/统一派发积分闸门-v2.md
 */
import type { BillingDecision, PlatformReserve } from '../shared/billingDecision';
import { resolveBillingRoute } from '../shared/billingRoute';
import {
  CREDITS_EXCEEDED_CODE,
  LOGIN_REQUIRED_CODE,
  creditsExceededUserMessage,
  platformAiLoginRequiredMessage,
} from '../shared/credits';
import { prechargePlatformCredits, releaseCreditReserve } from './creditsApi';
import {
  getLastCreditsReserveKey,
  getCreditsProxyRequestHeaders,
  markCreditsProxyHeadersFromGate,
  releaseCreditsProxyReserve,
} from './creditsProxyBridge';
import { adoptCreditsPrechargeSession } from './creditsPrechargeSession';
import { getGeminiFairnessUserId } from './geminiFairnessBridge';
import { HttpRequestError } from './httpClient';
import { pickBinding } from './modelRegistry/pickBinding';
import { hasTencentSessionCredentials } from './platformAiPath';
import { getTripoApiKey } from './settingsStore';

function hasTripoApiKeyFromSettings(): boolean {
  return Boolean(String(getTripoApiKey() || '').trim());
}

export type GateBeforeUpstreamParams = {
  jobKind: string;
  registryId?: string;
  role?: 'text' | 'image';
  generate3dProvider?: 'tripo' | 'tencent';
  hasTripoApiKey?: boolean;
  hasTencentCreds?: boolean;
  scopeKey?: string | null;
  userId?: string | null;
};

function inferRoleFromJobKind(jobKind: string): 'text' | 'image' {
  if (
    jobKind === 'workflow_text_to_image' ||
    jobKind === 'workflow_image_edit' ||
    jobKind.startsWith('workflow_jimeng')
  ) {
    return 'image';
  }
  return 'text';
}

function resolvePlatformUserId(userId?: string | null): string {
  return String(userId ?? getGeminiFairnessUserId() ?? '').trim();
}

/** platform 路径 reserve（vertex-proxy → proxy-bundle；其余 → precharge） */
export async function acquirePlatformReserve(
  decision: BillingDecision,
  scopeKey?: string | null
): Promise<PlatformReserve> {
  const min = Math.max(1, decision.minCredits);
  const scope = String(scopeKey || '').trim();

  if (decision.channel === 'vertex-proxy') {
    const proxyAdmissionHeaders = await getCreditsProxyRequestHeaders(min);
    const key = getLastCreditsReserveKey() || '';
    return {
      reserveKey: key,
      estimatedCredits: min,
      proxyAdmissionHeaders,
      release: async (outcome) => {
        if (outcome === 'failed') {
          await releaseCreditsProxyReserve();
        }
      },
    };
  }

  const res = await prechargePlatformCredits(min, scope || undefined);
  if (scope && res.prechargeKey) {
    adoptCreditsPrechargeSession(res, scope);
  }
  const reserveKey = res.prechargeKey || res.reserveKey || '';
  return {
    reserveKey,
    estimatedCredits: min,
    release: async (outcome) => {
      if (!reserveKey || outcome !== 'failed') return;
      await releaseCreditReserve(reserveKey, { fullVoid: true });
    },
  };
}

/** 每次向上游发请求前的唯一执行层入口：解析路由 + platform reserve。 */
export async function gateBeforeUpstream(params: GateBeforeUpstreamParams): Promise<BillingDecision> {
  const jobKind = String(params.jobKind || 'workflow_chat').trim() || 'workflow_chat';
  const role = params.role ?? inferRoleFromJobKind(jobKind);
  const registryId = String(params.registryId || jobKind).trim() || jobKind;
  const hasTencentCreds = params.hasTencentCreds ?? hasTencentSessionCredentials();

  let channel: string | undefined;
  if (params.registryId?.trim()) {
    channel = pickBinding(params.registryId.trim(), role)?.channel;
  }

  const route = resolveBillingRoute({
    jobKind,
    registryId: params.registryId,
    role,
    channel,
    generate3dProvider: params.generate3dProvider,
    hasTripoApiKey: params.hasTripoApiKey ?? hasTripoApiKeyFromSettings(),
    hasTencentCreds,
  });

  const decision: BillingDecision = {
    ...route,
    jobKind,
    registryId: params.registryId?.trim() || registryId,
    role,
    channel,
    minCredits: route.minCredits,
  };

  if (route.routeKind !== 'platform') {
    return decision;
  }

  if (!resolvePlatformUserId(params.userId)) {
    throw new HttpRequestError(platformAiLoginRequiredMessage(), 401, LOGIN_REQUIRED_CODE);
  }

  try {
    decision.platformReserve = await acquirePlatformReserve(decision, params.scopeKey);
  } catch (e) {
    if (e instanceof HttpRequestError && e.code === CREDITS_EXCEEDED_CODE) {
      const payload = e.payload;
      const available = Number(payload?.available ?? payload?.balance);
      const required = Number(payload?.required ?? payload?.amount ?? decision.minCredits);
      const msg = creditsExceededUserMessage(
        Number.isFinite(available) ? available : undefined,
        Number.isFinite(required) ? required : undefined
      );
      throw new HttpRequestError(msg, e.status, CREDITS_EXCEEDED_CODE, e.payload);
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (/积分不足|CREDITS_EXCEEDED/i.test(msg)) {
      throw new HttpRequestError(msg, 403, CREDITS_EXCEEDED_CODE);
    }
    throw e;
  }

  return decision;
}

/** Wave B gateway 包装：gate → fn → release reserve */
export async function runMeteredAiCallShell<T>(
  params: GateBeforeUpstreamParams,
  fn: (ctx: { billingDecision: BillingDecision }) => Promise<T>
): Promise<T> {
  const billingDecision = await gateBeforeUpstream(params);
  const pr = billingDecision.platformReserve;
  if (pr?.proxyAdmissionHeaders && pr.estimatedCredits > 0) {
    markCreditsProxyHeadersFromGate(pr.proxyAdmissionHeaders, pr.estimatedCredits);
  }
  let outcome: 'success' | 'failed' = 'success';
  try {
    return await fn({ billingDecision });
  } catch (err) {
    outcome = 'failed';
    throw err;
  } finally {
    if (outcome === 'failed') {
      await billingDecision.platformReserve?.release('failed');
    }
  }
}
