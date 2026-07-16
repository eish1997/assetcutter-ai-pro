/**
 * 站点代理 AI 统一积分准入（L1）— 经 unifiedAiGateway / 等价入口调用。
 * 平台代付路径须登录 + 余额足够；BYOK / 自带腾讯云密钥旁路 L1。
 */
import type { CustomAppModule } from '../types';
import {
  creditsBalanceLoadingMessage,
  creditsBalanceUnavailableMessage,
  creditsExceededUserMessage,
  platformAiLoginRequiredMessage,
  proxyGateJobKindForWorkflowBranch,
  proxyGateMinCreditsForJob,
} from '../shared/credits';
import { isPlatformMeteredGeminiPath, isPlatformMeteredJobKind } from './platformAiPath';
import { classifyWorkflowRunTaskBranch } from './workflowRunTaskBranch';
import {
  assertAiGateForRegistry,
  assertAiGateForSteps,
  isSubmitBlockedForPlatformPlan,
  planWorkflowActionRoutes,
  resolveJobKindBillingStep,
  resolveRegistryBillingStep,
  type AiBillingRouteStep,
} from './aiBillingGate';
import { gateBeforeUpstream } from './aiDispatchGate';
import type { CapabilitySet } from '../types';

export {
  proxyCreditsBypassedForCapabilityModule,
  proxyCreditsBypassedForCapabilitySet,
  proxyCreditsBypassedForQuickCompose,
  proxyCreditsBypassedForWorkflowAction,
  creditOverridesFromTaskLike,
} from './workflowCreditsBypass';
export type { CapabilityCreditOverrides } from './workflowCreditsBypass';
export { assertAiGateForRegistry } from './aiBillingGate';
export type { AiBillingRouteStep, AiBillingRouteKind } from './aiBillingGate';

/** 站点 AI Worker Proxy / Vertex 代理（平台代付密钥）是否已配置 */
export function platformSiteProxyConfigured(): boolean {
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

/** UI / 提交前：当前任务是否跳过平台积分预检（BYOK / 腾讯自带密钥等） */
export function proxyCreditsBypassedByByok(opts?: {
  registryId?: string | null;
  role?: 'text' | 'image';
  jobKind?: string | null;
}): boolean {
  if (opts?.registryId && !isPlatformMeteredGeminiPath(opts.registryId, opts.role ?? 'text')) return true;
  if (opts?.jobKind && !isPlatformMeteredJobKind(opts.jobKind)) return true;
  return false;
}

/** UI：是否应禁用 AI 提交（未登录 / 余额不足；BYOK 路径不拦） */
export function isPlatformAiSubmitBlocked(
  userId: string | null | undefined,
  balance: number | null,
  loading: boolean,
  jobKind?: string | null,
  opts?: {
    registryId?: string | null;
    role?: 'text' | 'image';
    steps?: AiBillingRouteStep[];
    minCreditsOverride?: number | null;
  }
): { blocked: boolean; reason?: string; estimatedMinCredits?: number } {
  if (opts?.steps?.length) {
    return isSubmitBlockedForPlatformPlan(opts.steps, userId, balance, loading, {
      minCreditsOverride: opts.minCreditsOverride,
    });
  }
  if (opts?.registryId) {
    const step = resolveRegistryBillingStep({
      registryId: opts.registryId,
      role: opts.role ?? 'text',
      jobKind: jobKind || 'workflow_chat',
    });
    if (step.kind !== 'platform') {
      return { blocked: false, estimatedMinCredits: 0 };
    }
    return isSubmitBlockedForPlatformPlan([step], userId, balance, loading);
  }
  const min = proxyGateMinCreditsForJob(jobKind);
  if (jobKind && !isPlatformMeteredJobKind(jobKind)) {
    return { blocked: false, estimatedMinCredits: 0 };
  }
  if (!userId?.trim()) {
    return { blocked: true, reason: platformAiLoginRequiredMessage(), estimatedMinCredits: min };
  }
  if (loading && balance == null) {
    return { blocked: true, reason: creditsBalanceLoadingMessage(), estimatedMinCredits: min };
  }
  if (balance == null) {
    return { blocked: true, reason: creditsBalanceUnavailableMessage(), estimatedMinCredits: min };
  }
  const available = balance;
  if (available < min) {
    return { blocked: true, reason: creditsExceededUserMessage(), estimatedMinCredits: min };
  }
  return { blocked: false, estimatedMinCredits: min };
}

/** @deprecated 使用 isPlatformAiSubmitBlocked */
export function isProxyCreditsBlockedLocally(
  balance: number | null,
  loading: boolean,
  userId: string | null | undefined,
  jobKind?: string | null
): boolean {
  return isPlatformAiSubmitBlocked(userId, balance, loading, jobKind).blocked;
}

export function isAiProxyWorkflowBranch(branch: string): boolean {
  return (
    branch === 'branch_capability_set' ||
    branch === 'branch_generate_3d' ||
    branch === 'branch_preset_execute_capability'
  );
}

function isAiProxyRunTaskBranch(branch: string): boolean {
  return isAiProxyWorkflowBranch(branch);
}

/** 登录 + 先预扣费（AI 代理任务统一入口；BYOK 旁路；已有会话池则校验余量） */
export async function assertPlatformAiCreditsAllowed(
  jobKind?: string | null,
  userId?: string | null,
  scopeKey?: string | null
): Promise<void> {
  const step = resolveJobKindBillingStep(jobKind || 'workflow_chat');
  if (step.kind !== 'platform') return;
  await assertAiGateForSteps([step], { userId, scopeKey });
}

/** Gemini 按 registry + role 预检（BYOK 旁路） */
export async function assertPlatformAiCreditsForGeminiTask(
  registryId: string,
  role: 'text' | 'image',
  jobKind: string,
  scopeKey?: string | null
): Promise<void> {
  await assertAiGateForRegistry(registryId, role, jobKind, scopeKey);
}

/** 按 actionType / module 预检积分（BYOK 全程旁路） */
export async function assertWorkflowCreditsPrecheckForAction(
  actionType: string,
  module?: CustomAppModule | null,
  userId?: string | null,
  opts?: { capabilitySet?: CapabilitySet | null; presets?: CustomAppModule[]; overrides?: CapabilityCreditOverrides }
): Promise<void> {
  const steps = planWorkflowActionRoutes(actionType, module ?? null, opts);
  if (!steps.length || !steps.some((s) => s.kind === 'platform')) return;
  await assertAiGateForSteps(steps, { userId });
}

export function resolveQuickComposeProxyJobKind(params: {
  mode: 'text' | 'image' | '3d';
  promptCards: ReadonlyArray<{ presetId: string }>;
  resolveModule: (presetId: string) => CustomAppModule | null | undefined;
}): string {
  const kinds: string[] = [];
  for (const card of params.promptCards) {
    const mod = params.resolveModule(card.presetId);
    if (!mod) continue;
    const branch = classifyWorkflowRunTaskBranch({ actionType: mod.id, module: mod });
    if (!isAiProxyRunTaskBranch(branch)) continue;
    kinds.push(proxyGateJobKindForWorkflowBranch(branch, mod));
  }
  if (kinds.length === 0) {
    if (params.mode === '3d') return 'workflow_generate_3d';
    if (params.mode === 'image') return 'workflow_text_to_image';
    return 'workflow_chat';
  }
  return kinds.reduce((best, k) =>
    proxyGateMinCreditsForJob(k) > proxyGateMinCreditsForJob(best) ? k : best
  );
}

export async function assertUnifiedProxyCreditsGate(
  jobKind?: string | null,
  scopeKey?: string | null,
  opts?: { registryId?: string | null; role?: 'text' | 'image' }
): Promise<void> {
  await gateBeforeUpstream({
    jobKind: jobKind || 'workflow_chat',
    registryId: opts?.registryId?.trim() || undefined,
    role: opts?.role,
    scopeKey,
  });
}

/** @deprecated 使用 assertPlatformAiCreditsAllowed */
export async function assertWorkflowCreditsPrecheck(jobKind?: string | null): Promise<void> {
  await assertPlatformAiCreditsAllowed(jobKind);
}
