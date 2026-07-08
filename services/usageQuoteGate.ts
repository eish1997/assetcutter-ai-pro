import {
  sumPlatformMinCredits,
  sumPlatformMinCreditsWithQuote,
  type AiBillingRouteStep,
} from './aiBillingGate';
import { fetchUsageQuote } from './usageApi';

export function platformJobKindsFromSteps(steps: AiBillingRouteStep[]): string[] {
  return [
    ...new Set(
      steps
        .filter((s) => s.kind === 'platform')
        .map((s) => String(s.jobKind || '').trim())
        .filter(Boolean)
    ),
  ];
}

/** 拉服务端价目 quote，返回 platform 步骤合计 minCredits；失败时返回 null（回退客户端 seed）。 */
export async function fetchServerMinCreditsForSteps(
  steps: AiBillingRouteStep[]
): Promise<number | null> {
  const kinds = platformJobKindsFromSteps(steps);
  if (!kinds.length) return null;
  try {
    const quote = await fetchUsageQuote(kinds);
    return sumPlatformMinCreditsWithQuote(steps, quote);
  } catch {
    return null;
  }
}

/** 队列开跑前：按「单任务最贵一步」预检，勿把 N 项合计误当一次性预扣（7525000 后易误报积分不足）。 */
export async function fetchMaxServerMinCreditsForStepsList(
  stepPlans: AiBillingRouteStep[][]
): Promise<number | null> {
  let maxMin = 0;
  for (const steps of stepPlans) {
    const kinds = platformJobKindsFromSteps(steps);
    if (!kinds.length) continue;
    const one = (await fetchServerMinCreditsForSteps(steps)) ?? sumPlatformMinCredits(steps);
    maxMin = Math.max(maxMin, one);
  }
  return maxMin > 0 ? maxMin : null;
}
