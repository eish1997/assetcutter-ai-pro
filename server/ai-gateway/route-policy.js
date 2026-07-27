import { resolveDispatchPolicyFromOptions } from './route-dispatch.js';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function selectionReasonFromPlan(plan) {
  const metadata = asRecord(plan?.job?.metadata) || {};
  const decision = asRecord(metadata.routeDecision) || {};
  const selected = asRecord(decision.selectedRoute) || {};
  return (
    asRecord(selected.selectionReason) ||
    asRecord(decision.selectionReason) ||
    asRecord(plan?.route?.selectionReason) ||
    null
  );
}

/** A4: explicit user provider / admin pin must not silently cross providers. */
export function isProviderPinnedForFallback(plan, options = {}) {
  if (options.allowExplicitProviderFallback === true) return false;
  const policy = resolveDispatchPolicyFromOptions(options);
  if (policy.runtimeFallback?.respectProviderPin === false) return false;
  const metadata = asRecord(plan?.job?.metadata) || {};
  if (metadata.providerPinned === true) return true;
  const reason = selectionReasonFromPlan(plan);
  if (nonEmptyString(reason?.strategy) === 'admin_pin') return true;
  return false;
}

const FALLBACK_POLICY_SET = new Set([
  'none',
  'on_error',
  'on_rate_limit',
  'on_timeout',
  'on_provider_degraded',
  'cost_optimized',
  'quality_first',
]);

export function publicAiGatewayErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string' && error.message.trim()) return error.message.trim();
    if (typeof error.body?.message === 'string' && error.body.message.trim()) return error.body.message.trim();
  }
  return String(error || 'AI Gateway execution failed');
}

function httpStatusFromError(error) {
  const direct = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const message = publicAiGatewayErrorMessage(error);
  const matched = message.match(/\bHTTP\s+(\d{3})\b/i) || message.match(/\b(status|code)[=: ]+(\d{3})\b/i);
  const raw = matched ? Number(matched[matched.length - 1]) : 0;
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

export function classifyAiGatewayFallbackError(error) {
  const message = publicAiGatewayErrorMessage(error);
  const lower = message.toLowerCase();
  const status = httpStatusFromError(error);
  const code = nonEmptyString(error?.code);

  if (code === 'AI_GATEWAY_PROVIDER_KEY_MISSING' || /no enabled .* api key/i.test(message)) {
    return { reason: 'provider_key_missing', retryable: true, status, policyKind: 'on_error' };
  }
  // 客户端/契约校验错误不可重试（勿被下方 network unavailable 文本规则误伤）
  if (error?.name === 'AiGatewayValidationError') {
    return { reason: 'validation_error', retryable: false, status, policyKind: 'none' };
  }
  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return { reason: 'rate_limit', retryable: true, status: status || 429, policyKind: 'on_rate_limit' };
  }
  if (code === 'AbortError' || code === 'TimeoutError' || lower.includes('timeout') || lower.includes('timed out')) {
    return { reason: 'timeout', retryable: true, status, policyKind: 'on_timeout' };
  }
  if (status >= 500 || lower.includes('network unavailable') || lower.includes('fetch failed')) {
    return {
      reason: status >= 500 ? 'upstream_5xx' : 'network_error',
      retryable: true,
      status,
      policyKind: 'on_provider_degraded',
    };
  }
  return { reason: status ? `http_${status}` : 'non_retryable_error', retryable: false, status, policyKind: 'none' };
}

function normalizeFallbackPolicies(value) {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const id = nonEmptyString(item);
    if (!FALLBACK_POLICY_SET.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function fallbackPoliciesForPlan(plan, options = {}) {
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  const policy = metadata.aiGatewayFallback && typeof metadata.aiGatewayFallback === 'object'
    ? metadata.aiGatewayFallback
    : {};
  const configured = normalizeFallbackPolicies(
    policy.policies || policy.policy || policy.fallbackPolicy || options.fallbackPolicies || options.fallbackPolicy
  );
  return configured.length ? configured : ['on_error'];
}

export function fallbackMaxAttemptsForPlan(plan, options = {}) {
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  const policy = metadata.aiGatewayFallback && typeof metadata.aiGatewayFallback === 'object'
    ? metadata.aiGatewayFallback
    : {};
  const n = Number(policy.maxAttempts || options.maxFallbackAttempts || 5);
  return Math.max(1, Math.min(5, Number.isFinite(n) ? Math.floor(n) : 5));
}

export function fallbackPolicyAllows(classification, policies) {
  if (!classification?.retryable) return false;
  const normalized = normalizeFallbackPolicies(policies);
  if (normalized.includes('none')) return false;
  if (normalized.includes('on_error')) return true;
  if (normalized.includes('cost_optimized') || normalized.includes('quality_first')) return true;
  if (classification.policyKind === 'on_rate_limit') return normalized.includes('on_rate_limit');
  if (classification.policyKind === 'on_timeout') return normalized.includes('on_timeout');
  if (classification.policyKind === 'on_provider_degraded') return normalized.includes('on_provider_degraded');
  return false;
}

export function evaluateAiGatewayFallback(plan, error, options = {}) {
  const classification = classifyAiGatewayFallbackError(error);
  const pinned = isProviderPinnedForFallback(plan, options);
  const enabled = fallbackEnabledForPlan(plan, options);
  const policies = fallbackPoliciesForPlan(plan, options);
  const policyAllowed = fallbackPolicyAllows(classification, policies);
  const dispatchPolicy = resolveDispatchPolicyFromOptions(options);
  const runtime = dispatchPolicy.runtimeFallback || {};
  const allowCrossProvider = runtime.allowCrossProvider !== false;
  const onTimeout = nonEmptyString(runtime.onTimeout) || 'switch_provider';
  const sameRouteRetryMax = Math.max(0, Math.min(3, Number(runtime.sameRouteRetryMax ?? 1) || 0));
  const metadata = asRecord(plan?.job?.metadata) || {};
  const fallbackMeta = asRecord(metadata.aiGatewayFallback) || {};
  const sameRouteRetryCount = Math.max(
    0,
    Number(options.sameRouteRetryCount ?? fallbackMeta.sameRouteRetryCount ?? 0) || 0
  );

  let shouldSameRouteRetry = false;
  let timeoutBlocksCrossProvider = false;
  if (classification.policyKind === 'on_timeout') {
    if (onTimeout === 'fail') {
      timeoutBlocksCrossProvider = true;
    } else if (onTimeout === 'same_route_retry') {
      if (sameRouteRetryCount < sameRouteRetryMax) {
        shouldSameRouteRetry = true;
      }
      // After same-route budget is spent, allow cross-provider only if still enabled.
    }
  }

  let skipReason = '';
  if (pinned) skipReason = 'provider_pinned';
  else if (shouldSameRouteRetry) skipReason = '';
  else if (timeoutBlocksCrossProvider) skipReason = 'timeout_fail_policy';
  else if (!allowCrossProvider) skipReason = 'cross_provider_fallback_disabled';
  else if (!enabled) skipReason = 'fallback_disabled';
  else if (!classification.retryable) skipReason = 'non_retryable_error';
  else if (!policyAllowed) skipReason = 'policy_disallowed';

  const shouldFallback =
    !pinned &&
    !shouldSameRouteRetry &&
    !timeoutBlocksCrossProvider &&
    allowCrossProvider &&
    enabled &&
    classification.retryable &&
    policyAllowed;

  return {
    ...classification,
    enabled: enabled && !pinned && allowCrossProvider && !timeoutBlocksCrossProvider,
    pinned,
    policies,
    policyAllowed,
    onTimeout,
    sameRouteRetryMax,
    sameRouteRetryCount,
    shouldSameRouteRetry: shouldSameRouteRetry && classification.retryable,
    shouldFallback,
    skipReason,
  };
}

export function fallbackEnabledForPlan(plan, options = {}) {
  if (options.fallbackEnabled === false) return false;
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  const policy = metadata.aiGatewayFallback && typeof metadata.aiGatewayFallback === 'object'
    ? metadata.aiGatewayFallback
    : {};
  if (policy.enabled === false) return false;
  if (policy.enabled === true) return true;
  if (policy.autoSelectedProvider === true) return true;
  if (options.allowExplicitProviderFallback === true) return true;
  return Boolean(metadata.modelRouteInference?.providerId);
}

export function appendAiGatewayFallbackAttempt(metadata, attempt) {
  const current = metadata && typeof metadata === 'object' ? metadata : {};
  const existing = current.aiGatewayFallback && typeof current.aiGatewayFallback === 'object'
    ? current.aiGatewayFallback
    : {};
  const attempts = Array.isArray(existing.attempts) ? existing.attempts : [];
  return {
    ...current,
    aiGatewayFallback: {
      ...existing,
      attempts: [
        ...attempts,
        {
          at: attempt.at || new Date().toISOString(),
          providerId: attempt.providerId || null,
          adapterId: attempt.adapterId || null,
          workerId: attempt.workerId || null,
          reason: attempt.reason || 'unknown',
          retryable: attempt.retryable === true,
          policyKind: attempt.policyKind || 'none',
          policies: Array.isArray(attempt.policies) ? attempt.policies : [],
          policyAllowed: attempt.policyAllowed === true,
          message: attempt.message || '',
          status: attempt.status || 0,
        },
      ],
    },
  };
}

export function appendAiGatewayFallbackSkip(metadata, skip) {
  const current = metadata && typeof metadata === 'object' ? metadata : {};
  const existing = current.aiGatewayFallback && typeof current.aiGatewayFallback === 'object'
    ? current.aiGatewayFallback
    : {};
  const skipped = Array.isArray(existing.skipped) ? existing.skipped : [];
  return {
    ...current,
    aiGatewayFallback: {
      ...existing,
      skipped: [
        ...skipped,
        {
          at: skip.at || new Date().toISOString(),
          providerId: skip.providerId || null,
          adapterId: skip.adapterId || null,
          reason: skip.reason || 'unknown',
          skipReason: skip.skipReason || 'fallback_skipped',
          retryable: skip.retryable === true,
          policyKind: skip.policyKind || 'none',
          policies: Array.isArray(skip.policies) ? skip.policies : [],
          message: skip.message || '',
          status: skip.status || 0,
        },
      ],
    },
  };
}

export function fallbackDisabledProviders(plan, options = {}) {
  const disabled = new Set(
    Array.isArray(options.disabledProviders)
      ? options.disabledProviders.map((provider) => nonEmptyString(provider)).filter(Boolean)
      : []
  );
  if (Array.isArray(options.opsControl?.disabledProviders)) {
    for (const provider of options.opsControl.disabledProviders) {
      const id = nonEmptyString(provider);
      if (id) disabled.add(id);
    }
  }
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  const attempts = Array.isArray(metadata.aiGatewayFallback?.attempts) ? metadata.aiGatewayFallback.attempts : [];
  for (const attempt of attempts) {
    const providerId = nonEmptyString(attempt?.providerId);
    if (providerId) disabled.add(providerId);
  }
  const currentProvider = nonEmptyString(plan?.route?.providerId || plan?.job?.provider);
  if (currentProvider) disabled.add(currentProvider);
  return [...disabled];
}
