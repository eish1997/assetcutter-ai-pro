import {
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
