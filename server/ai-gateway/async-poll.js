/**
 * A3: shared async poll timing + terminal status vocabulary for video/3D/long jobs.
 * Adapters own fetch/mapping; this module owns interval/timeout math and status normalization.
 */

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * Normalize upstream status strings into Gateway terminal/running vocabulary.
 * @returns {'queued'|'running'|'succeeded'|'failed'|'cancelled'}
 */
export function normalizeAiGatewayAsyncStatus(value) {
  const s = String(value || '').trim().toLowerCase();
  if (['queued', 'pending', 'created', 'submitted', 'waiting'].includes(s)) return 'queued';
  if (['running', 'processing', 'in_progress', 'generating'].includes(s)) return 'running';
  if (['succeeded', 'success', 'finished', 'done', 'completed'].includes(s)) return 'succeeded';
  if (['cancelled', 'canceled', 'aborted'].includes(s)) return 'cancelled';
  if (['failed', 'error', 'expired'].includes(s)) return 'failed';
  return 'running';
}

/**
 * Resolve poll interval/timeout with a safe floor.
 * When options override interval explicitly, floor can be 1ms (tests).
 */
export function resolveAiGatewayAsyncPollTiming(options = {}) {
  const defaults = options.defaults && typeof options.defaults === 'object' ? options.defaults : {};
  const intervalFloorMs = options.pollIntervalMs != null ? 1 : Number(options.intervalFloorMs || 1000);
  const defaultInterval = Number(defaults.pollIntervalMs || 5000);
  const defaultTimeout = Number(defaults.pollTimeoutMs || 900_000);
  const intervalMs = Math.max(
    Number.isFinite(intervalFloorMs) ? intervalFloorMs : 1000,
    Number(options.pollIntervalMs ?? defaultInterval)
  );
  const timeoutMs = Math.max(intervalMs, Number(options.pollTimeoutMs ?? defaultTimeout));
  const requestTimeoutMs = Math.max(
    1000,
    Number(options.pollRequestTimeoutMs ?? defaults.pollRequestMs ?? 30_000)
  );
  return {
    intervalMs: Math.floor(intervalMs),
    timeoutMs: Math.floor(timeoutMs),
    requestTimeoutMs: Math.floor(requestTimeoutMs),
  };
}

export function asyncPollDelay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer?.unref === 'function') timer.unref();
  });
}

/**
 * Generic poll loop. `tick` returns:
 * - { done: true } to stop (caller already finalized)
 * - { done: false, jobStatus?: 'queued'|'running' } to continue
 * On timeout, calls `onTimeout` once (must finalize failed job).
 */
export async function runAiGatewayAsyncPollLoop(options = {}) {
  const { intervalMs, timeoutMs } = resolveAiGatewayAsyncPollTiming(options);
  const startedAt = Date.now();
  const tick = typeof options.tick === 'function' ? options.tick : null;
  const onTimeout = typeof options.onTimeout === 'function' ? options.onTimeout : null;
  if (!tick) throw new Error('runAiGatewayAsyncPollLoop requires tick()');

  while (Date.now() - startedAt < timeoutMs) {
    await asyncPollDelay(intervalMs);
    const result = await tick({
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
      intervalMs,
    });
    if (result?.done) return { timedOut: false, ...result };
  }
  if (onTimeout) {
    await onTimeout({
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
      intervalMs,
      code: nonEmptyString(options.timeoutCode) || 'AI_GATEWAY_ASYNC_POLL_TIMEOUT',
      message:
        nonEmptyString(options.timeoutMessage) ||
        `Async poll timed out after ${timeoutMs}ms`,
    });
  }
  return { timedOut: true, timeoutMs, intervalMs };
}

export function modalityDefaultPollTimeoutMs(modality) {
  const id = nonEmptyString(modality);
  if (id === 'image') return 600_000;
  if (id === 'video') return 900_000;
  if (id === 'model3d') return 900_000;
  return 300_000;
}
