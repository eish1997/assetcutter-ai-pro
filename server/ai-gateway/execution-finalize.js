import { recordAiGatewayUsageEvent } from './usage-event.js';
import { settleAiGatewayJobCredits, settlementMetadataPatch } from './settlement.js';
import { gatewayFailureMetadata } from './failure-reason.js';
import { validateJobAgainstAdapterContract, jobPatchFromAdapterResult, normalizeAiGatewayAdapterResult } from './adapter-result.js';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

export async function finalizeAiGatewayTerminalPlan(plan, store) {
  if (!plan?.job || !TERMINAL_STATUSES.has(plan.job.status)) return plan;
  let next = plan;

  if (plan.job.status === 'succeeded') {
    const contract = validateJobAgainstAdapterContract(plan.job);
    if (!contract.ok && store?.update) {
      const { patch } = jobPatchFromAdapterResult(
        {
          status: 'failed',
          output: {
            ...(plan.job.output && typeof plan.job.output === 'object' ? plan.job.output : {}),
            raw: {
              rejectedSucceededJob: {
                artifacts: plan.job.artifacts,
                output: plan.job.output,
              },
              contractErrors: contract.errors,
            },
          },
          failureReason: {
            code: 'AI_GATEWAY_ADAPTER_RESULT_INVALID',
            message: `Succeeded job failed adapter contract: ${contract.errors.join(', ')}`,
          },
        },
        {
          modality: plan.job.modality,
          providerId: plan.route?.providerId || plan.job?.provider || null,
          adapterId: plan.route?.adapterId || null,
          workerId: plan.route?.workerId || null,
          metadata: plan.job.metadata,
          defaultFailureCode: 'AI_GATEWAY_ADAPTER_RESULT_INVALID',
        }
      );
      next = await store.update(next.job.id, patch);
    }
  }

  if (next.job.status === 'failed' && !next.job?.metadata?.gatewayFailure && store?.update) {
    const failureMeta = gatewayFailureMetadata(next.job.error || { code: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED' }, {
      defaultCode: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED',
      providerId: next.route?.providerId || next.job?.provider || null,
      adapterId: next.route?.adapterId || null,
      workerId: next.route?.workerId || null,
    });
    next = await store.update(next.job.id, { metadata: failureMeta });
  }
  if (next.job.status === 'succeeded') {
    await recordAiGatewayUsageEvent(next).catch(() => null);
  }
  const settlement = await settleAiGatewayJobCredits(next).catch(() => ({ settled: false }));
  const metadata = settlementMetadataPatch(next, settlement);
  if (Object.keys(metadata).length && store?.update) {
    next = await store.update(next.job.id, { metadata });
  }
  return next;
}

export { normalizeAiGatewayAdapterResult, validateJobAgainstAdapterContract };