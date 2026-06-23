import type { UsageEventInput } from '../../shared/usageBilling';
import { recordUsageEvent } from '../recordUsageEvent';

export function emitUsageEvents(drafts: UsageEventInput[]): void {
  for (const draft of drafts) {
    recordUsageEvent(draft);
  }
}
