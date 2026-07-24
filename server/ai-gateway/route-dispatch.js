/**
 * Slice 6: explainable route dispatch on top of resolveAiGatewayRouteDecision.
 * selectedRoute.selectionReason is the audit surface — no black-box ranking.
 */

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

const HEALTH_SCORE = Object.freeze({
  healthy: 100,
  idle: 95,
  warning: 70,
  degraded: 40,
  rate_limited: 20,
  cooling_down: 5,
  unknown: 80,
});

export const DEFAULT_DISPATCH_POLICY = Object.freeze({
  strategy: 'priority_health_cost',
  healthWeight: 40,
  costWeight: 20,
  priorityWeight: 40,
  /** Lower admin priority number wins (same as existing bindingOverrides). */
  preferLowerPriority: true,
  /** Relative cost hints: higher = more expensive (penalized). Default 50. */
  costHints: Object.freeze({}),
  /** Admin pin: force provider for a model when that candidate is ready. */
  providerPins: Object.freeze([]),
  /** Canary: prefer provider for percent of traffic (0-100) when ready. */
  canary: Object.freeze([]),
});

export function normalizeDispatchPolicy(raw) {
  const input = asRecord(raw) || {};
  const weights = {
    healthWeight: Number.isFinite(Number(input.healthWeight)) ? Number(input.healthWeight) : DEFAULT_DISPATCH_POLICY.healthWeight,
    costWeight: Number.isFinite(Number(input.costWeight)) ? Number(input.costWeight) : DEFAULT_DISPATCH_POLICY.costWeight,
    priorityWeight: Number.isFinite(Number(input.priorityWeight))
      ? Number(input.priorityWeight)
      : DEFAULT_DISPATCH_POLICY.priorityWeight,
  };
  return {
    strategy: nonEmptyString(input.strategy) || DEFAULT_DISPATCH_POLICY.strategy,
    ...weights,
    preferLowerPriority: input.preferLowerPriority !== false,
    costHints: { ...DEFAULT_DISPATCH_POLICY.costHints, ...(asRecord(input.costHints) || {}) },
    providerPins: Array.isArray(input.providerPins) ? input.providerPins.map((row) => asRecord(row)).filter(Boolean) : [],
    canary: Array.isArray(input.canary) ? input.canary.map((row) => asRecord(row)).filter(Boolean) : [],
  };
}

export function resolveDispatchPolicyFromOptions(options = {}) {
  const fromOpsControl = asRecord(options.opsControl)?.dispatchPolicy;
  const fromModelOps = asRecord(options.modelOpsConfig)?.dispatchPolicy;
  const nested = asRecord(options.dispatchPolicy) || asRecord(fromOpsControl) || asRecord(fromModelOps);
  return normalizeDispatchPolicy(nested);
}

function healthStatusForProvider(providerId, keys) {
  const id = nonEmptyString(providerId);
  if (!id || !Array.isArray(keys)) return 'unknown';
  const rows = keys.filter((row) => nonEmptyString(row?.provider) === id && row?.enabled !== false);
  if (!rows.length) return 'unknown';
  const statuses = rows.map((row) => nonEmptyString(row?.runtime?.healthStatus || row?.healthStatus).toLowerCase() || 'idle');
  if (statuses.includes('cooling_down')) return 'cooling_down';
  if (statuses.includes('rate_limited')) return 'rate_limited';
  if (statuses.includes('degraded')) return 'degraded';
  if (statuses.includes('warning')) return 'warning';
  if (statuses.includes('healthy')) return 'healthy';
  return 'idle';
}

function relativeCost(providerId, policy) {
  const hint = Number(policy.costHints?.[providerId]);
  if (Number.isFinite(hint)) return Math.max(0, Math.min(100, hint));
  return 50;
}

function priorityScore(priority, preferLowerPriority) {
  const p = Number.isFinite(Number(priority)) ? Number(priority) : 100;
  if (!preferLowerPriority) return Math.max(0, Math.min(100, p));
  // priority 1 → ~99, priority 100 → ~50, priority 200 → ~1
  return Math.max(0, Math.min(100, Math.round(100 - p / 2)));
}

function matchingPin(policy, context) {
  const model = nonEmptyString(context.canonicalModelId);
  const modality = nonEmptyString(context.modality);
  if (!model) return null;
  for (const pin of policy.providerPins) {
    if (pin.enabled === false) continue;
    if (nonEmptyString(pin.canonicalModelId) !== model) continue;
    if (nonEmptyString(pin.modality) && nonEmptyString(pin.modality) !== modality) continue;
    const providerId = nonEmptyString(pin.providerId);
    if (!providerId) continue;
    return pin;
  }
  return null;
}

function matchingCanary(policy, context) {
  const model = nonEmptyString(context.canonicalModelId);
  for (const row of policy.canary) {
    if (row.enabled === false) continue;
    const providerId = nonEmptyString(row.providerId);
    if (!providerId) continue;
    const pattern = nonEmptyString(row.modelPattern);
    if (pattern) {
      try {
        if (!new RegExp(pattern, 'i').test(model)) continue;
      } catch {
        continue;
      }
    } else if (nonEmptyString(row.canonicalModelId) && nonEmptyString(row.canonicalModelId) !== model) {
      continue;
    }
    const percent = Math.max(0, Math.min(100, Number(row.percent) || 0));
    if (percent <= 0) continue;
    return { ...row, providerId, percent };
  }
  return null;
}

function stableBucket(seed) {
  const text = String(seed || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

/**
 * Score one ready route candidate.
 * @returns {{ providerId: string, route: object, total: number, factors: object }}
 */
export function scoreDispatchCandidate(route, context = {}, policyInput = {}) {
  const policy = normalizeDispatchPolicy(policyInput);
  const providerId = nonEmptyString(route?.providerId);
  const healthStatus = healthStatusForProvider(providerId, context.keys);
  const health = HEALTH_SCORE[healthStatus] ?? HEALTH_SCORE.unknown;
  const cost = relativeCost(providerId, policy);
  const costScore = 100 - cost;
  const priority = Number.isFinite(Number(route?.priority)) ? Number(route.priority) : Number(context.priorityByProvider?.[providerId]) || 100;
  const pScore = priorityScore(priority, policy.preferLowerPriority);
  const weightSum = Math.max(1, policy.healthWeight + policy.costWeight + policy.priorityWeight);
  const total =
    (health * policy.healthWeight + costScore * policy.costWeight + pScore * policy.priorityWeight) / weightSum;
  return {
    providerId,
    route,
    total: Math.round(total * 100) / 100,
    factors: {
      healthStatus,
      healthScore: health,
      relativeCost: cost,
      costScore,
      priority,
      priorityScore: pScore,
    },
  };
}

/**
 * Select among ready routes with an explainable reason.
 */
export function selectRouteWithDispatchPolicy(readyRoutes, context = {}, policyInput = {}) {
  const policy = normalizeDispatchPolicy(policyInput);
  const routes = Array.isArray(readyRoutes) ? readyRoutes.filter(Boolean) : [];
  if (!routes.length) {
    return {
      selected: null,
      selectionReason: {
        strategy: policy.strategy,
        code: 'AI_GATEWAY_DISPATCH_NO_CANDIDATE',
        message: 'No ready route candidates for dispatch',
        auditedAt: new Date().toISOString(),
      },
      scored: [],
    };
  }

  const pin = matchingPin(policy, context);
  if (pin) {
    const pinned = routes.find((row) => nonEmptyString(row.providerId) === nonEmptyString(pin.providerId));
    if (pinned) {
      const scored = routes.map((route) => scoreDispatchCandidate(route, context, policy));
      return {
        selected: pinned,
        selectionReason: {
          strategy: 'admin_pin',
          code: 'AI_GATEWAY_DISPATCH_ADMIN_PIN',
          message: `Admin pin selected provider ${pin.providerId}`,
          override: {
            kind: 'provider_pin',
            providerId: pin.providerId,
            reason: nonEmptyString(pin.reason) || null,
            rollback: 'Remove providerPins entry in ops dispatchPolicy to restore automatic ranking',
          },
          scores: scored.map((row) => ({
            providerId: row.providerId,
            total: row.total,
            factors: row.factors,
          })),
          auditedAt: new Date().toISOString(),
        },
        scored,
      };
    }
  }

  const canary = matchingCanary(policy, context);
  if (canary) {
    const bucketSeed = nonEmptyString(context.correlationId) || `${context.canonicalModelId}:${context.modality}:${Date.now()}`;
    const bucket = stableBucket(bucketSeed);
    if (bucket < canary.percent) {
      const canaryRoute = routes.find((row) => nonEmptyString(row.providerId) === canary.providerId);
      if (canaryRoute) {
        const scored = routes.map((route) => scoreDispatchCandidate(route, context, policy));
        return {
          selected: canaryRoute,
          selectionReason: {
            strategy: 'canary',
            code: 'AI_GATEWAY_DISPATCH_CANARY',
            message: `Canary selected ${canary.providerId} (bucket ${bucket} < ${canary.percent}%)`,
            override: {
              kind: 'canary',
              providerId: canary.providerId,
              percent: canary.percent,
              bucket,
              rollback: 'Disable or remove canary entry in ops dispatchPolicy',
            },
            scores: scored.map((row) => ({
              providerId: row.providerId,
              total: row.total,
              factors: row.factors,
            })),
            auditedAt: new Date().toISOString(),
          },
          scored,
        };
      }
    }
  }

  const scored = routes
    .map((route) => scoreDispatchCandidate(route, context, policy))
    .sort(
      (a, b) =>
        b.total - a.total ||
        Number(a.factors.priority) - Number(b.factors.priority) ||
        String(a.providerId).localeCompare(String(b.providerId))
    );
  const winner = scored[0];
  return {
    selected: winner.route,
    selectionReason: {
      strategy: policy.strategy,
      code: 'AI_GATEWAY_DISPATCH_RANKED',
      message: `Ranked by health(${policy.healthWeight}) + cost(${policy.costWeight}) + priority(${policy.priorityWeight}); selected ${winner.providerId} score=${winner.total}`,
      scores: scored.map((row) => ({
        providerId: row.providerId,
        total: row.total,
        factors: row.factors,
      })),
      auditedAt: new Date().toISOString(),
    },
    scored,
  };
}
