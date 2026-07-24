import { isAiGatewayExecutionEnabled } from './health.js';
import { createAiGatewayJobPlan } from './index.js';
import { maybeAutoPauseAiGatewayProvider } from './ops-control.js';
import {
  appendAiGatewayFallbackAttempt,
  appendAiGatewayFallbackSkip,
  evaluateAiGatewayFallback,
  fallbackDisabledProviders,
  fallbackEnabledForPlan,
  fallbackMaxAttemptsForPlan,
  publicAiGatewayErrorMessage,
} from './route-policy.js';
import { settleAiGatewayJobCredits, settlementMetadataPatch } from './settlement.js';
import { startAiGatewayWorkerExecution } from './workers/registry.js';
import { gatewayFailureMetadata, decorateErrorWithFailureReason } from './failure-reason.js';

async function settleFailedExecution(plan, store) {
  if (!plan || !store?.update) return plan;
  const settlement = await settleAiGatewayJobCredits(plan);
  const settlementMetadata = settlementMetadataPatch(plan, settlement);
  if (!Object.keys(settlementMetadata).length) return plan;
  return store.update(plan.job.id, { metadata: settlementMetadata });
}

function planInputForRetry(plan, metadata) {
  const job = plan?.job || {};
  const nextMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  // Drop prior decision so fallback can re-select with disabledProviders (single-truth re-decide).
  delete nextMetadata.routeDecision;
  delete nextMetadata.modelRouteGuard;
  return {
    id: job.id,
    modality: job.modality,
    capability: job.capability,
    model: job.model,
    userId: job.userId,
    correlationId: job.correlationId,
    input: job.input,
    metadata: nextMetadata,
  };
}

async function maybePlanFallback(plan, error, options = {}) {
  const store = options.store;
  const classification = evaluateAiGatewayFallback(plan, error, options);
  if (!classification.shouldFallback) {
    if (store?.update && (fallbackEnabledForPlan(plan, options) || classification.retryable)) {
      const skippedMetadata = appendAiGatewayFallbackSkip(plan.job?.metadata, {
        at: new Date().toISOString(),
        providerId: plan.route?.providerId || plan.job?.provider || '',
        adapterId: plan.route?.adapterId || '',
        reason: classification.reason,
        skipReason: classification.skipReason,
        retryable: classification.retryable,
        policyKind: classification.policyKind,
        policies: classification.policies,
        status: classification.status,
        message: publicAiGatewayErrorMessage(error),
      });
      await store.update(plan.job.id, {
        metadata: { aiGatewayFallback: skippedMetadata.aiGatewayFallback },
      });
    }
    return null;
  }
  const at = new Date().toISOString();
  const metadata = appendAiGatewayFallbackAttempt(plan.job?.metadata, {
    at,
    providerId: plan.route?.providerId || plan.job?.provider || '',
    adapterId: plan.route?.adapterId || '',
    workerId: plan.route?.workerId || '',
    reason: classification.reason,
    retryable: classification.retryable,
    policyKind: classification.policyKind,
    policies: classification.policies,
    policyAllowed: classification.policyAllowed,
    status: classification.status,
    message: publicAiGatewayErrorMessage(error),
  });
  const disabledProviders = fallbackDisabledProviders({ ...plan, job: { ...(plan.job || {}), metadata } }, options);
  try {
    const fallbackPlan = createAiGatewayJobPlan(planInputForRetry(plan, metadata), {
      ...options,
      opsControl: {
        ...(options.opsControl || {}),
        disabledProviders,
      },
    });
    if (fallbackPlan.route?.providerId === plan.route?.providerId) return null;
    const next = {
      ...fallbackPlan,
      job: {
        ...fallbackPlan.job,
        status: 'created',
        provider: fallbackPlan.route?.providerId || fallbackPlan.job.provider,
        metadata: {
          ...(fallbackPlan.job.metadata || {}),
          aiGatewayFallback: {
            ...(fallbackPlan.job.metadata?.aiGatewayFallback || {}),
            active: true,
            nextProviderId: fallbackPlan.route?.providerId || null,
            nextAdapterId: fallbackPlan.route?.adapterId || null,
            lastFallbackAt: at,
          },
        },
      },
    };
    if (store?.put) await Promise.resolve(store.put(next));
    return next;
  } catch {
    if (store?.update) {
      await store.update(plan.job.id, {
        metadata: {
          aiGatewayFallback: {
            ...metadata.aiGatewayFallback,
            exhausted: true,
            exhaustedAt: at,
          },
        },
      });
    }
    return null;
  }
}

export async function startAiGatewayJobExecution(plan, options = {}) {
  if (!isAiGatewayExecutionEnabled()) return { started: false, skipped: true, reason: 'execution_disabled', plan };
  if (!plan?.job?.id || !plan?.adapterRequest) {
    return { started: false, skipped: true, reason: 'missing_adapter_request', plan };
  }

  let currentPlan = plan;
  const maxAttempts = fallbackMaxAttemptsForPlan(currentPlan, options);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await startAiGatewayWorkerExecution(currentPlan, options);
    } catch (error) {
      const fallbackPlan = attempt < maxAttempts ? await maybePlanFallback(currentPlan, error, options) : null;
      if (fallbackPlan) {
        currentPlan = fallbackPlan;
        continue;
      }
      return await failAiGatewayExecution(currentPlan, error, options);
    }
  }
  return { started: false, skipped: true, reason: 'fallback_attempts_exhausted', plan: currentPlan };
}

async function failAiGatewayExecution(plan, error, options = {}) {
  const store = options.store;
  const failedAt = new Date().toISOString();
  const decorated = decorateErrorWithFailureReason(error, {
    defaultCode: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED',
    providerId: plan.route?.providerId || plan.job?.provider || null,
    adapterId: plan.route?.adapterId || null,
    workerId: plan.route?.workerId || null,
  });
  const failureError = {
    code: decorated?.code || error?.code || 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED',
    message: publicAiGatewayErrorMessage(decorated || error),
    ...(decorated?.failureReason ? { failureReason: decorated.failureReason } : {}),
  };
  const failedPlan = {
    ...plan,
    job: {
      ...(plan.job || {}),
      status: 'failed',
      error: failureError,
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
  const autoCircuit = await maybeAutoPauseAiGatewayProvider(failedPlan, decorated || error, {
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
      error: publicAiGatewayErrorMessage(decorated || error),
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
    ...gatewayFailureMetadata(decorated || failureError, {
      defaultCode: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED',
      providerId: plan.route?.providerId || plan.job?.provider || null,
      adapterId: plan.route?.adapterId || null,
      workerId: plan.route?.workerId || null,
    }),
  };
  const failed = store?.update
    ? await store.update(plan.job.id, {
        status: 'failed',
        metadata,
        error: failureError,
      })
    : plan;
  const settled = await settleFailedExecution(failed, store);
  return { started: false, error, plan: settled || failed || plan };
}
