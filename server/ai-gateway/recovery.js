import { isAiGatewayExecutionEnabled } from './health.js';
import { persistentAiGatewayJobStore } from './persistent-job-store.js';
import { startAiGatewayJobExecution } from './executor.js';

const ACTIVE_STATUSES = new Set(['created', 'queued']);
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_MIN_AGE_MS = 30_000;
const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;

const runningRecoveries = new Set();
let recoveryTimer = null;

function numberFromEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

function metadataOf(plan) {
  return plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
}

function gatewayExecutionOf(plan) {
  const meta = metadataOf(plan);
  return meta.gatewayExecution && typeof meta.gatewayExecution === 'object' ? meta.gatewayExecution : {};
}

function proxyJobIdOf(plan) {
  const meta = metadataOf(plan);
  return String(meta.proxyJobId || meta.gatewayExecution?.proxyJobId || '').trim();
}

function ageMsFrom(value, nowMs) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : 0;
}

export function shouldRecoverAiGatewayJob(plan, options = {}) {
  if (!plan?.job?.id || !plan?.adapterRequest) return false;
  if (!ACTIVE_STATUSES.has(String(plan.job.status || ''))) return false;
  if (proxyJobIdOf(plan)) return false;

  const metadata = metadataOf(plan);
  if (!metadata.authApiFacade) return false;

  const nowMs = Number(options.nowMs || Date.now());
  const minAgeMs = numberFromEnv('AI_GATEWAY_RECOVERY_MIN_AGE_MS', options.minAgeMs ?? DEFAULT_MIN_AGE_MS);
  const maxAgeMs = numberFromEnv('AI_GATEWAY_RECOVERY_MAX_AGE_MS', options.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
  const ageMs = ageMsFrom(plan.job.updatedAt || plan.job.createdAt, nowMs);
  if (ageMs < minAgeMs) return false;
  if (maxAgeMs > 0 && ageMs > maxAgeMs) return false;

  const gatewayExecution = gatewayExecutionOf(plan);
  if (gatewayExecution.deferredAttempt != null || gatewayExecution.lastHandoffError) return true;
  return true;
}

export async function recoverAiGatewayQueuedJobs(options = {}) {
  if (!isAiGatewayExecutionEnabled()) return { ok: true, skipped: true, reason: 'execution_disabled', recovered: 0 };
  const store = options.store || persistentAiGatewayJobStore;
  const limit = Math.max(1, Math.floor(Number(options.limit || process.env.AI_GATEWAY_RECOVERY_LIMIT || DEFAULT_LIMIT)));
  const plans = await store.list({ limit });
  const candidates = plans.filter((plan) => shouldRecoverAiGatewayJob(plan, options));
  let recovered = 0;
  const errors = [];

  for (const plan of candidates) {
    const id = plan.job.id;
    if (runningRecoveries.has(id)) continue;
    runningRecoveries.add(id);
    try {
      const gatewayExecution = gatewayExecutionOf(plan);
      await startAiGatewayJobExecution(plan, {
        store,
        deferredHandoffAttempt: gatewayExecution.deferredAttempt,
        awaitBackgroundPoll: options.awaitBackgroundPoll,
        disableBackgroundPoll: options.disableBackgroundPoll,
        fetchImpl: options.fetchImpl,
        healthFetchImpl: options.healthFetchImpl,
        handoffRetries: options.handoffRetries,
        handoffRetryDelayMs: options.handoffRetryDelayMs,
        handoffRetryJitterMs: options.handoffRetryJitterMs,
        handoffHealthProbe: options.handoffHealthProbe,
      });
      recovered += 1;
    } catch (error) {
      errors.push({ id, message: error instanceof Error ? error.message : String(error || 'Recovery failed') });
    } finally {
      runningRecoveries.delete(id);
    }
  }

  return { ok: errors.length === 0, recovered, scanned: plans.length, candidates: candidates.length, errors };
}

export function startAiGatewayQueueRecoveryLoop(options = {}) {
  if (recoveryTimer) return recoveryTimer;
  if (String(process.env.AI_GATEWAY_RECOVERY_ENABLED || 'true').trim().toLowerCase() === 'false') return null;
  const intervalMs = Math.max(5_000, Number(options.intervalMs || process.env.AI_GATEWAY_RECOVERY_INTERVAL_MS || DEFAULT_INTERVAL_MS));
  const tick = async () => {
    try {
      const result = await recoverAiGatewayQueuedJobs(options);
      if (result.recovered) {
        console.log(`[ai-gateway-recovery] recovered=${result.recovered} candidates=${result.candidates} scanned=${result.scanned}`);
      }
    } catch (error) {
      console.warn('[ai-gateway-recovery] failed:', error instanceof Error ? error.message : String(error));
    }
  };
  recoveryTimer = setInterval(tick, intervalMs);
  if (typeof recoveryTimer.unref === 'function') recoveryTimer.unref();
  void tick();
  console.log(`[ai-gateway-recovery] interval=${intervalMs}ms`);
  return recoveryTimer;
}

export function stopAiGatewayQueueRecoveryLoop() {
  if (!recoveryTimer) return;
  clearInterval(recoveryTimer);
  recoveryTimer = null;
}
