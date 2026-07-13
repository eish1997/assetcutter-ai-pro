const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const ACTIVE_STATUSES = new Set(['created', 'queued', 'running']);

function toMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function safeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function routeProvider(plan) {
  const route = plan?.route && typeof plan.route === 'object' ? plan.route : {};
  const job = plan?.job || {};
  return (
    safeString(route.providerId) ||
    safeString(route.adapterId) ||
    safeString(job.provider) ||
    safeString(route.upstreamBackend) ||
    'unknown'
  );
}

function modelKey(plan) {
  const job = plan?.job || {};
  return safeString(job.model) || safeString(job.capability) || safeString(job.modality) || 'unknown';
}

function classifyError(plan) {
  const error = plan?.job?.error;
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  const message = [
    error && typeof error === 'object' ? error.code : '',
    error && typeof error === 'object' ? error.message : error,
    metadata.proxyStatus,
    metadata.settlementSource,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!message) return null;
  if (/429|too many requests|rate.?limit|quota|rpm|resource_exhausted/.test(message)) return 'rate_limited';
  if (/login|required|unauth|401/.test(message)) return 'auth';
  if (/credit|balance|payment|reserve/.test(message)) return 'credits';
  if (/timeout|timed.?out|deadline/.test(message)) return 'timeout';
  return 'upstream';
}

function durationMs(plan) {
  const started = toMs(plan?.job?.startedAt || plan?.job?.createdAt);
  const finished = toMs(plan?.job?.finishedAt || (TERMINAL_STATUSES.has(plan?.job?.status) ? plan?.job?.updatedAt : null));
  if (started == null || finished == null || finished < started) return null;
  return finished - started;
}

function emptyStatusCounts() {
  return {
    created: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
}

function emptyErrorCounts() {
  return {
    rate_limited: 0,
    auth: 0,
    credits: 0,
    timeout: 0,
    upstream: 0,
  };
}

function createGroup(key) {
  return {
    key,
    total: 0,
    statusCounts: emptyStatusCounts(),
    errorCounts: emptyErrorCounts(),
    active: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    avgDurationMs: null,
    maxDurationMs: null,
    failureRate: 0,
    rateLimitRate: 0,
    _durationTotal: 0,
    _durationCount: 0,
  };
}

function addToGroup(group, plan) {
  const status = safeString(plan?.job?.status) || 'created';
  group.total += 1;
  if (group.statusCounts[status] != null) group.statusCounts[status] += 1;
  if (ACTIVE_STATUSES.has(status)) group.active += 1;
  if (status === 'succeeded') group.succeeded += 1;
  if (status === 'failed') group.failed += 1;
  if (status === 'cancelled') group.cancelled += 1;
  const kind = status === 'failed' ? classifyError(plan) : null;
  if (kind && group.errorCounts[kind] != null) group.errorCounts[kind] += 1;
  const ms = durationMs(plan);
  if (ms != null) {
    group._durationTotal += ms;
    group._durationCount += 1;
    group.maxDurationMs = group.maxDurationMs == null ? ms : Math.max(group.maxDurationMs, ms);
  }
}

function finalizeGroup(group) {
  const terminal = group.succeeded + group.failed + group.cancelled;
  const rateLimited = group.errorCounts.rate_limited;
  return {
    key: group.key,
    total: group.total,
    statusCounts: group.statusCounts,
    errorCounts: group.errorCounts,
    active: group.active,
    succeeded: group.succeeded,
    failed: group.failed,
    cancelled: group.cancelled,
    avgDurationMs: group._durationCount ? Math.round(group._durationTotal / group._durationCount) : null,
    maxDurationMs: group.maxDurationMs,
    failureRate: terminal ? group.failed / terminal : 0,
    rateLimitRate: group.failed ? rateLimited / group.failed : 0,
  };
}

function topGroups(map, limit = 8) {
  return Array.from(map.values())
    .map(finalizeGroup)
    .sort((a, b) => b.total - a.total || b.failed - a.failed || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function buildAiGatewayOpsSummary(plans, options = {}) {
  const items = Array.isArray(plans) ? plans : [];
  const providerGroups = new Map();
  const modelGroups = new Map();
  const statusCounts = emptyStatusCounts();
  const errorCounts = emptyErrorCounts();
  let active = 0;
  let terminal = 0;
  let firstCreatedAt = null;
  let lastCreatedAt = null;

  for (const plan of items) {
    const status = safeString(plan?.job?.status) || 'created';
    if (statusCounts[status] != null) statusCounts[status] += 1;
    if (ACTIVE_STATUSES.has(status)) active += 1;
    if (TERMINAL_STATUSES.has(status)) terminal += 1;
    const kind = status === 'failed' ? classifyError(plan) : null;
    if (kind && errorCounts[kind] != null) errorCounts[kind] += 1;

    const provider = routeProvider(plan);
    const model = modelKey(plan);
    if (!providerGroups.has(provider)) providerGroups.set(provider, createGroup(provider));
    if (!modelGroups.has(model)) modelGroups.set(model, createGroup(model));
    addToGroup(providerGroups.get(provider), plan);
    addToGroup(modelGroups.get(model), plan);

    const created = safeString(plan?.job?.createdAt);
    if (created) {
      if (!firstCreatedAt || created < firstCreatedAt) firstCreatedAt = created;
      if (!lastCreatedAt || created > lastCreatedAt) lastCreatedAt = created;
    }
  }

  const failed = statusCounts.failed;
  return {
    generatedAt: options.nowIso || new Date().toISOString(),
    sampleSize: items.length,
    limit: Number(options.limit) || items.length,
    window: { firstCreatedAt, lastCreatedAt },
    totals: {
      total: items.length,
      active,
      terminal,
      statusCounts,
      errorCounts,
      failureRate: terminal ? failed / terminal : 0,
      rateLimitRate: failed ? errorCounts.rate_limited / failed : 0,
    },
    byProvider: topGroups(providerGroups),
    byModel: topGroups(modelGroups),
  };
}
