import { fetch as undiciFetch } from 'undici';
import { aiWorkerProxyUpstreamBase } from '../../ai-worker-proxy-relay.js';
import { creditsProxyHeadersFromSigned, fairnessKeyForUserId, signCreditsGatePayload } from '../../credits-gate-hmac.js';
import { settleAiGatewayJobCredits, settlementMetadataPatch } from '../settlement.js';
import { maybeAutoPauseAiGatewayProvider } from '../ops-control.js';
import {
  extractAiGatewayArtifactsFromProxyResult,
  sanitizeProxyResultForAiGatewayJob,
} from '../../ai-worker-proxy-usage.js';

function publicErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'AI Gateway execution failed');
}

function creditsGate(plan) {
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  return metadata.creditsGate && typeof metadata.creditsGate === 'object' ? metadata.creditsGate : null;
}

function executionHeaders(plan, options = {}) {
  const headers = {
    ...(plan.adapterRequest?.headers && typeof plan.adapterRequest.headers === 'object' ? plan.adapterRequest.headers : {}),
  };
  const cookieHeader = String(options.cookieHeader || '').trim();
  if (cookieHeader && !headers.Cookie && !headers.cookie) {
    headers.Cookie = cookieHeader;
  }
  const userId = String(plan.job?.userId || '').trim();
  const fairnessKey = fairnessKeyForUserId(userId);
  if (fairnessKey) {
    headers['X-AC-Fairness-Key'] = fairnessKey;
  }

  const gate = creditsGate(plan);
  const reserveKey = String(gate?.reserveKey || '').trim();
  const estimatedCredits = Math.max(1, Math.floor(Number(gate?.estimatedCredits || gate?.reserveAmount || 0)));
  if (userId && reserveKey && estimatedCredits) {
    Object.assign(headers, creditsProxyHeadersFromSigned(signCreditsGatePayload({ userId, reserveKey, estimatedCredits })));
    if (!headers['X-AC-Credits-Reserve']) headers['X-AC-Credits-Reserve'] = reserveKey;
  }
  return headers;
}

function parseProxyCreateResponse(text) {
  try {
    const parsed = JSON.parse(text || '{}');
    return {
      jobId: String(parsed.jobId || '').trim(),
      status: String(parsed.status || 'pending').trim() || 'pending',
      raw: parsed,
    };
  } catch {
    return { jobId: '', status: 'invalid', raw: text };
  }
}

function pollDelay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

function isRetryableHandoffStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function retryAfterMs(response) {
  const raw = response?.headers?.get ? String(response.headers.get('retry-after') || '').trim() : '';
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, seconds * 1000);
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.min(30_000, Math.max(0, dateMs - Date.now()));
  return 0;
}

async function handoffRetryDelay(attempt, response, options = {}) {
  const configured = Number(options.handoffRetryDelayMs ?? process.env.AI_GATEWAY_PROXY_HANDOFF_RETRY_DELAY_MS ?? 2500);
  const baseMs = Number.isFinite(configured) ? Math.max(0, configured) : 2500;
  const jitterMs = Number(options.handoffRetryJitterMs ?? process.env.AI_GATEWAY_PROXY_HANDOFF_RETRY_JITTER_MS ?? 500);
  const retryAfter = retryAfterMs(response);
  const delayMs = Math.min(30_000, Math.max(retryAfter, baseMs * Math.max(1, attempt) + Math.floor(Math.random() * Math.max(0, jitterMs))));
  if (delayMs > 0) await pollDelay(delayMs);
}

function proxyPollUrl(plan, proxyJobId) {
  const path = String(plan.adapterRequest?.path || '/proxy/gemini/async').replace(/\/+$/, '');
  return `${aiWorkerProxyUpstreamBase()}${path}/${encodeURIComponent(proxyJobId)}`;
}

async function settleIfNeeded(plan, store) {
  if (!plan || !store?.update) return plan;
  const settlement = await settleAiGatewayJobCredits(plan);
  const settlementMetadata = settlementMetadataPatch(plan, settlement);
  if (!Object.keys(settlementMetadata).length) return plan;
  return store.update(plan.job.id, { metadata: settlementMetadata });
}

export async function pollAiWorkerProxyJob(plan, proxyJobId, options = {}) {
  const store = options.store;
  if (!store?.update || !plan?.job?.id || !proxyJobId) return;
  const fetchImpl = options.fetchImpl || undiciFetch;
  const startedAt = Date.now();
  const intervalFloorMs = options.pollIntervalMs != null ? 1 : 1000;
  const intervalMs = Math.max(intervalFloorMs, Number(options.pollIntervalMs || process.env.AI_GATEWAY_PROXY_POLL_INTERVAL_MS || 3000));
  const timeoutMs = Math.max(intervalMs, Number(options.pollTimeoutMs || process.env.AI_GATEWAY_PROXY_POLL_TIMEOUT_MS || 660_000));
  let current = plan;

  while (Date.now() - startedAt < timeoutMs) {
    await pollDelay(intervalMs);
    try {
      const response = await fetchImpl(proxyPollUrl(plan, proxyJobId), {
        method: 'GET',
        signal: AbortSignal.timeout(Number(options.pollRequestTimeoutMs || 15_000)),
      });
      const text = await response.text();
      if (!response.ok) continue;
      const body = JSON.parse(text || '{}');
      const status = String(body.status || '').trim();
      if (status === 'completed') {
        const result = body.result ?? null;
        current = await store.update(plan.job.id, {
          status: 'succeeded',
          output: sanitizeProxyResultForAiGatewayJob(result),
          artifacts: extractAiGatewayArtifactsFromProxyResult(result),
          metadata: {
            proxyJobId,
            proxyStatus: 'completed',
            gatewayExecution: { completedAt: new Date().toISOString() },
          },
        });
        await settleIfNeeded(current, store);
        return;
      }
      if (status === 'failed') {
        current = await store.update(plan.job.id, {
          status: 'failed',
          error: { code: 'AI_WORKER_PROXY_ASYNC_FAILED', message: String(body.error || 'AI Worker Proxy job failed') },
          metadata: {
            proxyJobId,
            proxyStatus: 'failed',
            gatewayExecution: { failedAt: new Date().toISOString() },
          },
        });
        await settleIfNeeded(current, store);
        return;
      }
      if (status === 'running' || status === 'queued' || status === 'pending') {
        current = await store.update(plan.job.id, {
          status: status === 'running' ? 'running' : 'queued',
          metadata: { proxyJobId, proxyStatus: status },
        });
      }
    } catch {
      // Polling is best-effort; the next panel refresh can still read the last known state.
    }
  }
}

export async function startAiWorkerProxyExecution(plan, options = {}) {
  const store = options.store;
  const fetchImpl = options.fetchImpl || undiciFetch;
  const targetUrl = `${aiWorkerProxyUpstreamBase()}${plan.adapterRequest.path}`;

  try {
    const maxRetries = Math.max(0, Math.floor(Number(options.handoffRetries ?? process.env.AI_GATEWAY_PROXY_HANDOFF_RETRIES ?? 2)));
    let response = null;
    let text = '';
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      response = await fetchImpl(targetUrl, {
        method: plan.adapterRequest.method || 'POST',
        headers: executionHeaders(plan, options),
        body: JSON.stringify(plan.adapterRequest.body || {}),
        signal: AbortSignal.timeout(Number(options.timeoutMs || process.env.AI_GATEWAY_EXECUTION_START_TIMEOUT_MS || 30_000)),
      });
      text = await response.text();
      if (response.ok) break;
      if (!isRetryableHandoffStatus(response.status) || attempt >= maxRetries) {
        throw new Error(`AI Worker Proxy rejected AI job handoff: HTTP ${response.status} ${text.slice(0, 300)}`);
      }
      await handoffRetryDelay(attempt + 1, response, options);
    }
    const proxy = parseProxyCreateResponse(text);
    if (!proxy.jobId) throw new Error(`AI Worker Proxy did not return jobId: ${text.slice(0, 300)}`);

    const metadata = {
      gatewayExecution: {
        startedAt: new Date().toISOString(),
        handoffStatus: proxy.status,
        targetPath: plan.adapterRequest.path,
      },
      proxyJobId: proxy.jobId,
      proxyStatus: proxy.status,
    };
    const next = store?.update
      ? await store.update(plan.job.id, { status: proxy.status === 'queued' ? 'queued' : 'running', metadata })
      : plan;
    if (!options.disableBackgroundPoll) {
      const pollPromise = pollAiWorkerProxyJob(next || plan, proxy.jobId, options);
      if (options.awaitBackgroundPoll) await pollPromise;
      else void pollPromise;
    }
    return { started: true, upstreamJobId: proxy.jobId, proxyJobId: proxy.jobId, proxyStatus: proxy.status, plan: next || plan };
  } catch (error) {
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
        targetPath: plan.adapterRequest.path,
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
    let next = store?.update
      ? await store.update(plan.job.id, {
          status: 'failed',
          metadata,
          error: { code: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED', message: publicErrorMessage(error) },
        })
      : plan;
    if (next && store?.update) {
      const settlement = await settleAiGatewayJobCredits(next);
      const settlementMetadata = settlementMetadataPatch(next, settlement);
      if (Object.keys(settlementMetadata).length) {
        next = await store.update(plan.job.id, { metadata: settlementMetadata });
      }
    }
    return { started: false, error, plan: next || plan };
  }
}
