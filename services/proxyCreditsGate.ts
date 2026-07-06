/**
 * 站点代理 AI 统一积分准入（L1）— 经 unifiedAiGateway / 等价入口调用。
 * BYOK（用户自带 Gemini Key）跳过；访客走 trial 日次（见 trialGeminiQuota）。
 */
import { CREDITS_EXCEEDED_CODE, proxyGateMinCreditsForJob } from '../shared/credits';
import { fetchCreditBalance } from './creditsApi';
import { HttpRequestError } from './httpClient';
import { getUserApiKey } from './settingsStore';
import { assertCreditsGateBeforeProxyOrThrow } from './trialGeminiQuota';

export async function assertUnifiedProxyCreditsGate(jobKind?: string | null): Promise<void> {
  if (getUserApiKey()?.trim()) return;
  const estimatedCredits = proxyGateMinCreditsForJob(jobKind);
  await assertCreditsGateBeforeProxyOrThrow(estimatedCredits);
}

/** 工作流跑任务前本地预检（BYOK 跳过；余额不足抛 CREDITS_EXCEEDED） */
export async function assertWorkflowCreditsPrecheck(jobKind?: string | null): Promise<void> {
  if (getUserApiKey()?.trim()) return;
  const min = proxyGateMinCreditsForJob(jobKind);
  const { balance } = await fetchCreditBalance();
  if (balance < min) {
    throw new HttpRequestError('积分不足', 403, CREDITS_EXCEEDED_CODE);
  }
}
