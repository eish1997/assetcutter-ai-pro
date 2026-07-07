import type { UsageEventInput } from '../../shared/usageBilling';
import { CREDITS_EXCEEDED_CODE } from '../../shared/credits';
import { recordUsageEvent, recordUsageEventAwait } from '../recordUsageEvent';
import { HttpRequestError } from '../httpClient';

export function emitUsageEvents(drafts: UsageEventInput[]): void {
  for (const draft of drafts) {
    recordUsageEvent(draft);
  }
}

/** 同步扣费：成功路径须 await，积分不足时抛出 CREDITS_EXCEEDED */
export async function emitUsageEventsAwait(drafts: UsageEventInput[]): Promise<void> {
  for (const draft of drafts) {
    await recordUsageEventAwait(draft);
  }
}

export function isCreditsExceededUsageError(err: unknown): boolean {
  if (err instanceof HttpRequestError && err.code === CREDITS_EXCEEDED_CODE) return true;
  return false;
}
