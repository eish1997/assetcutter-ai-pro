/**
 * 用户一次提交 = 一个任务信封：内部多步串行，占槽至整包成功或任一步失败。
 * 与 ai-worker-proxy 公平限流「单用户单请求」对齐；整包复用同一 proxy 预扣头。
 */
import type { AiBillingRouteStep } from './aiBillingGate';
import { requiresPlatformCredits, sumPlatformMinCredits } from './aiBillingGate';
import {
  clearLastCreditsReserveKey,
  getCreditsProxyRequestHeaders,
  markCreditsProxyHeadersFromGate,
  releaseCreditsProxyReserve,
} from './creditsProxyBridge';
import { peekCreditsPrechargeSession } from './creditsPrechargeSession';
import { getGeminiFairnessRequestHeaders } from './geminiFairnessBridge';

let activeEnvelopeId: string | null = null;
let envelopePlatformGateCredits: number | null = null;
let envelopeProxyHeaders: Record<string, string> | null = null;

function clearEnvelopeProxyState(): void {
  envelopePlatformGateCredits = null;
  envelopeProxyHeaders = null;
}

export function beginAiTaskEnvelope(taskId: string): void {
  const id = String(taskId || '').trim();
  if (!id) return;
  activeEnvelopeId = id;
  // 上一任务成功结算后预扣已 finalized；勿把失效 reserveKey 带进新信封
  clearLastCreditsReserveKey();
  clearEnvelopeProxyState();
}

export function endAiTaskEnvelope(taskId: string): void {
  const id = String(taskId || '').trim();
  if (id && activeEnvelopeId === id) {
    activeEnvelopeId = null;
    clearEnvelopeProxyState();
  }
}

export const AI_TASK_ENVELOPE_HEADER = 'X-AC-Task-Envelope';

export function getActiveAiTaskEnvelopeId(): string | null {
  return activeEnvelopeId;
}

/** 活跃任务信封 → proxy 公平限流头（同 envelope 多步占 1 槽） */
export function getActiveAiTaskEnvelopeRequestHeaders(): Record<string, string> {
  const id = getActiveAiTaskEnvelopeId();
  if (!id) return {};
  return { [AI_TASK_ENVELOPE_HEADER]: id };
}

export function isAiTaskEnvelopeActive(): boolean {
  return activeEnvelopeId != null;
}

/** P2：是否有任务信封占槽（禁止并发再提交） */
export function isAiTaskBusy(): boolean {
  return isAiTaskEnvelopeActive();
}

/** 任务开跑前一次性取 bundle（按各 platform 步 min 之和），供理解+生图复用同一预扣 */
export async function prepareAiTaskEnvelopeCredits(steps: AiBillingRouteStep[]): Promise<number | null> {
  if (!activeEnvelopeId || !requiresPlatformCredits(steps)) return null;
  const totalMin = sumPlatformMinCredits(steps);
  if (totalMin <= 0) return null;
  const fairness = getGeminiFairnessRequestHeaders();
  const proxyHeaders = await getCreditsProxyRequestHeaders(totalMin);
  envelopePlatformGateCredits = totalMin;
  envelopeProxyHeaders = { ...proxyHeaders };
  markCreditsProxyHeadersFromGate({ ...fairness, ...proxyHeaders }, totalMin);
  return totalMin;
}

/** geminiService 准入头：信封内复用整包预扣（estimatedCredits ≤ 整包 max 时） */
export function getEnvelopeProxyAdmissionHeaders(estimatedCredits: number): Record<string, string> | null {
  if (!activeEnvelopeId || !envelopeProxyHeaders) return null;
  const min = Math.max(1, Math.floor(Number(estimatedCredits) || 1));
  const envMin = envelopePlatformGateCredits ?? 0;
  if (envMin >= min) return { ...envelopeProxyHeaders };
  return null;
}

export function getEnvelopePlatformGateCredits(): number | null {
  return envelopePlatformGateCredits;
}

/** 任务结束：失败时释放孤儿预扣；成功由 metering 结算，清本地预扣缓存避免下一任务复用 */
export async function finalizeAiTaskEnvelopeCredits(outcome: 'success' | 'failed'): Promise<void> {
  if (outcome === 'failed' && !peekCreditsPrechargeSession()) {
    await releaseCreditsProxyReserve();
  } else {
    clearLastCreditsReserveKey();
  }
  clearEnvelopeProxyState();
}

export async function runInAiTaskEnvelope<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  beginAiTaskEnvelope(taskId);
  try {
    return await fn();
  } finally {
    endAiTaskEnvelope(taskId);
  }
}
