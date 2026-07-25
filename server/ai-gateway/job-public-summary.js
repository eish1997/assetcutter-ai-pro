import { publicAiGatewayCancelSummary } from './cancel-result.js';

function record(value) {
  return value && typeof value === 'object' ? value : {};
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function compactAttempt(item) {
  const raw = record(item);
  return {
    at: raw.at || null,
    providerId: raw.providerId || null,
    adapterId: raw.adapterId || null,
    workerId: raw.workerId || null,
    reason: raw.reason || null,
    skipReason: raw.skipReason || null,
    retryable: raw.retryable === true,
    policyKind: raw.policyKind || null,
    policies: arr(raw.policies).filter(Boolean),
    policyAllowed: raw.policyAllowed === true,
    status: Number(raw.status || 0) || 0,
    message: raw.message || '',
  };
}

export function routeSummary(route) {
  if (!route || typeof route !== 'object') return null;
  return {
    providerId: route.providerId || null,
    workerId: route.workerId || null,
    adapterId: route.adapterId || null,
    legacyAdapterId: route.legacyAdapterId || null,
    channel: route.channel || null,
    upstreamBackend: route.upstreamBackend || null,
  };
}

export function errorSummary(error) {
  if (!error) return null;
  if (typeof error === 'object') {
    return {
      code: error.code || null,
      message: error.message || String(error),
    };
  }
  return { code: null, message: String(error) };
}

export function fallbackSummary(metadata) {
  const fallback = record(record(metadata).aiGatewayFallback);
  const attempts = arr(fallback.attempts).map(compactAttempt);
  const skipped = arr(fallback.skipped).map(compactAttempt);
  const maxAttempts = Number(fallback.maxAttempts || 0);
  const active = fallback.active === true || attempts.length > 0;
  if (!active && skipped.length === 0 && !nonEmptyString(fallback.policy)) return null;
  const lastAttempt = attempts[attempts.length - 1] || null;
  const lastSkipped = skipped[skipped.length - 1] || null;
  return {
    active,
    policy: nonEmptyString(fallback.policy || fallback.fallbackPolicy) || null,
    policies: arr(fallback.policies).filter(Boolean),
    autoSelectedProvider: fallback.autoSelectedProvider === true,
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? Math.max(1, Math.min(5, Math.floor(maxAttempts))) : null,
    nextProviderId: fallback.nextProviderId || null,
    nextAdapterId: fallback.nextAdapterId || null,
    lastFallbackAt: fallback.lastFallbackAt || lastAttempt?.at || null,
    attempts,
    skipped,
    attemptCount: attempts.length,
    skippedCount: skipped.length,
    lastReason: lastAttempt?.reason || lastSkipped?.reason || null,
    lastSkipReason: lastSkipped?.skipReason || null,
    exhausted: fallback.exhausted === true,
    exhaustedAt: fallback.exhaustedAt || null,
  };
}

export function publicAiJobSummary(plan) {
  const metadata = record(plan?.job?.metadata);
  return {
    id: plan.job.id,
    status: plan.job.status,
    modality: plan.job.modality,
    capability: plan.job.capability,
    provider: plan.job.provider || null,
    model: plan.job.model || null,
    userId: plan.job.userId || null,
    correlationId: plan.job.correlationId,
    createdAt: plan.job.createdAt,
    updatedAt: plan.job.updatedAt,
    startedAt: plan.job.startedAt || null,
    finishedAt: plan.job.finishedAt || null,
    route: routeSummary(plan.route),
    traceOnly: Boolean(metadata.traceOnly),
    proxyPath: metadata.proxyPath || null,
    proxyJobId: metadata.proxyJobId || null,
    creditsGate: metadata.creditsGate || null,
    fallback: fallbackSummary(metadata),
    routeDecision: metadata.routeDecision || null,
    gatewayFailure: metadata.gatewayFailure || null,
    workerCancel: publicAiGatewayCancelSummary(metadata.workerCancel),
    error: errorSummary(plan.job.error),
  };
}
