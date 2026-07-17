import { resetPostgresPool } from '../auth-store.js';

function isTransientPostgresError(err) {
  const code = String(err?.code || '').trim();
  const msg = String(err?.message || err || '');
  return (
    code === '57P01' ||
    code === '57P02' ||
    code === '57P03' ||
    code === '08003' ||
    code === '08006' ||
    /Connection terminated unexpectedly|ECONNRESET|ECONNREFUSED|ETIMEDOUT|terminating connection|connection timeout|server closed the connection|database system is in recovery mode|database system is starting up|database system is not yet accepting connections/i.test(
      msg
    )
  );
}

function errorSummary(err) {
  const code = String(err?.code || '').trim();
  const msg = String(err?.message || err || '').trim();
  return [code, msg].filter(Boolean).join(' ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt) {
  const base = Number(process.env.AI_GATEWAY_PG_RETRY_BASE_MS || 450);
  const capped = Math.min(5_000, base * 2 ** Math.max(0, attempt));
  return capped + Math.floor(Math.random() * 150);
}

export async function withAiGatewayPostgresRetry(label, fn, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || process.env.AI_GATEWAY_PG_RETRY_ATTEMPTS || 7));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientPostgresError(err) || attempt >= attempts - 1) throw err;
      console.warn(
        `[ai-gateway] transient postgres error in ${label}; resetting pool and retrying (${attempt + 1}/${attempts}):`,
        errorSummary(err)
      );
      resetPostgresPool();
      await sleep(retryDelayMs(attempt));
    }
  }
  return fn();
}

