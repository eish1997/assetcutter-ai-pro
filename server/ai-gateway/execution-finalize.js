import { recordAiGatewayUsageEvent } from './usage-event.js';
import { settleAiGatewayJobCredits, settlementMetadataPatch } from './settlement.js';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

export async function finalizeAiGatewayTerminalPlan(plan, store) {
  if (!plan?.job || !TERMINAL_STATUSES.has(plan.job.status)) return plan;
  let next = plan;
  if (plan.job.status === 'succeeded') {
    await recordAiGatewayUsageEvent(next).catch(() => null);
  }
  const settlement = await settleAiGatewayJobCredits(next).catch(() => ({ settled: false }));
  const metadata = settlementMetadataPatch(next, settlement);
  if (Object.keys(metadata).length && store?.update) {
    next = await store.update(next.job.id, { metadata });
  }
  return next;
}
