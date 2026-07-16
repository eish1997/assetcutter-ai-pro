import { isUpstreamRateLimitError } from './ai-worker-proxy-retry.js';

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX_EVENTS = 500;

const events = [];

function nowMs() {
  return Date.now();
}

function windowMs() {
  const raw = Number(process.env.AI_WORKER_PROXY_OBSERVABILITY_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_WINDOW_MS;
}

function maxEvents() {
  const raw = Number(process.env.AI_WORKER_PROXY_OBSERVABILITY_MAX_EVENTS);
  return Number.isFinite(raw) && raw > 10 ? Math.floor(raw) : DEFAULT_MAX_EVENTS;
}

function classifyError(err) {
  if (!err) return null;
  if (isUpstreamRateLimitError(err)) return 'upstream_rate_limit';
  const msg = String((err && err.message) || err);
  if (/CREDITS|积分|LOGIN_REQUIRED|请先登录/i.test(msg)) return 'credits_or_auth';
  if (/timeout|DEADLINE_EXCEEDED|Deadline expired/i.test(msg)) return 'timeout';
  if (/overloaded|UNAVAILABLE|503|504|high demand/i.test(msg)) return 'upstream_overload';
  return 'other';
}

function prune(now = nowMs()) {
  const cutoff = now - windowMs();
  while (events.length && (events[0].ts < cutoff || events.length > maxEvents())) {
    events.shift();
  }
}

export function recordAiWorkerProxyThrottleWait(info = {}) {
  const ts = nowMs();
  events.push({
    type: 'throttle_wait',
    ts,
    waitMs: Math.max(0, Math.floor(Number(info.waitMs) || 0)),
    minIntervalMs: Math.max(0, Math.floor(Number(info.minIntervalMs) || 0)),
    provider: 'vertex',
    modality: 'image',
  });
  prune(ts);
}

export function beginAiWorkerProxyUpstreamCall(info = {}) {
  const startedAt = nowMs();
  const base = {
    provider: info.useVertex ? 'vertex' : 'gemini-aistudio',
    modality: info.modality || (String(info.model || '').toLowerCase().includes('image') ? 'image' : 'text'),
    model: String(info.model || ''),
    jobId: info.jobId || null,
  };
  return {
    end(extra = {}) {
      const ts = nowMs();
      const err = extra.error || null;
      events.push({
        type: 'upstream_call',
        ts,
        ...base,
        status: err ? 'failed' : 'succeeded',
        durationMs: Math.max(0, ts - startedAt),
        errorKind: classifyError(err),
      });
      prune(ts);
    },
  };
}

export function aiWorkerProxyObservabilitySnapshot() {
  prune();
  const summary = {
    windowMs: windowMs(),
    events: events.length,
    upstreamCalls: 0,
    vertexImageCalls: 0,
    succeeded: 0,
    failed: 0,
    upstreamRateLimit: 0,
    throttleWaits: 0,
    throttleWaitMsTotal: 0,
    avgDurationMs: 0,
    byModel: {},
  };
  let durationTotal = 0;
  for (const ev of events) {
    if (ev.type === 'throttle_wait') {
      summary.throttleWaits += 1;
      summary.throttleWaitMsTotal += ev.waitMs || 0;
      continue;
    }
    if (ev.type !== 'upstream_call') continue;
    summary.upstreamCalls += 1;
    if (ev.provider === 'vertex' && ev.modality === 'image') summary.vertexImageCalls += 1;
    if (ev.status === 'succeeded') summary.succeeded += 1;
    if (ev.status === 'failed') summary.failed += 1;
    if (ev.errorKind === 'upstream_rate_limit') summary.upstreamRateLimit += 1;
    durationTotal += ev.durationMs || 0;
    const model = ev.model || 'unknown';
    const bucket = summary.byModel[model] || { calls: 0, failed: 0, upstreamRateLimit: 0 };
    bucket.calls += 1;
    if (ev.status === 'failed') bucket.failed += 1;
    if (ev.errorKind === 'upstream_rate_limit') bucket.upstreamRateLimit += 1;
    summary.byModel[model] = bucket;
  }
  summary.avgDurationMs = summary.upstreamCalls ? Math.round(durationTotal / summary.upstreamCalls) : 0;
  summary.avgThrottleWaitMs = summary.throttleWaits
    ? Math.round(summary.throttleWaitMsTotal / summary.throttleWaits)
    : 0;
  return summary;
}

export function resetAiWorkerProxyObservabilityForTests() {
  events.length = 0;
}
