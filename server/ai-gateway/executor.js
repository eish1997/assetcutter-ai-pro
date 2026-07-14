import { isAiGatewayExecutionEnabled } from './health.js';
import { maybeAutoPauseAiGatewayProvider } from './ops-control.js';
import { settleAiGatewayJobCredits, settlementMetadataPatch } from './settlement.js';
import { startAiGatewayWorkerExecution } from './workers/registry.js';

function publicErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'AI Gateway execution failed');
}

async function settleFailedExecution(plan, store) {
  if (!plan || !store?.update) return plan;
  const settlement = await settleAiGatewayJobCredits(plan);
  const settlementMetadata = settlementMetadataPatch(plan, settlement);
  if (!Object.keys(settlementMetadata).length) return plan;
  return store.update(plan.job.id, { metadata: settlementMetadata });
}

export async function startAiGatewayJobExecution(plan, options = {}) {
  if (!isAiGatewayExecutionEnabled()) return { started: false, skipped: true, reason: 'execution_disabled', plan };
  if (!plan?.job?.id || !plan?.adapterRequest) {
    return { started: false, skipped: true, reason: 'missing_adapter_request', plan };
  }

  try {
    return await startAiGatewayWorkerExecution(plan, options);
  } catch (error) {
    const store = options.store;
    const failedAt = new Date().toISOString();
    const failedPlan = {
      ...plan,
      job: {
        ...(plan.job || {}),
        status: 'failed',
        error: { code: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED', message: publicErrorMessage(error) },
        finishedAt: failedAt,
        updatedAt: failedAt,
      },
    };
    const provider = plan.route?.providerId || plan.job?.provider || '';
    let recentPlans = [];
    if (store?.list && provider) {
      try {
        recentPlans = await Promise.resolve(store.list({ provider, limit: options.autoCircuitWindowLimit || 20 }));
      } catch {
        recentPlans = [];
      }
    }
    const autoCircuit = await maybeAutoPauseAiGatewayProvider(failedPlan, error, {
      recentPlans,
      windowLimit: options.autoCircuitWindowLimit,
      minTerminal: options.autoCircuitMinTerminal,
      minFailures: options.autoCircuitMinFailures,
      failureRate: options.autoCircuitFailureRate,
      minRateLimited: options.autoCircuitMinRateLimited,
      ttlMinutes: options.autoCircuitTtlMinutes,
    }).catch(() => null);
    const metadata = {
      gatewayExecution: {
        failedAt,
        error: publicErrorMessage(error),
        targetPath: plan.adapterRequest?.path || null,
        workerId: plan.route?.workerId || null,
        adapterId: plan.route?.adapterId || null,
        autoCircuit: autoCircuit
          ? {
              providerId: plan.route?.providerId || null,
              updatedAt: autoCircuit.updatedAt || null,
              disabledProviders: autoCircuit.disabledProviders || [],
              action: autoCircuit.autoCircuitAction || null,
            }
          : null,
      },
    };
    const failed = store?.update
      ? await store.update(plan.job.id, {
          status: 'failed',
          metadata,
          error: { code: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED', message: publicErrorMessage(error) },
        })
      : plan;
    const settled = await settleFailedExecution(failed, store);
    return { started: false, error, plan: settled || failed || plan };
  }
}
