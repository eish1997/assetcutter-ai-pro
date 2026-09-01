import { Agent, fetch as undiciFetch } from 'undici';
import { aiWorkerProxyUpstreamBase } from '../../ai-worker-proxy-relay.js';
import { acquireProviderKey } from '../provider-key-store.js';
import {
  creditsProxyHeadersFromSigned,
  fairnessKeyForUserId,
  signCreditsGatePayload,
  signFairnessKeyHeader,
} from '../../credits-gate-hmac.js';
import { AI_GATEWAY_HANDOFF_HEADER, signAiGatewayHandoffToken } from '../handoff-token.js';
import { applyAiGatewayAdapterResult, throwIfAdapterPlanTerminalFailed } from '../adapter-result.js';
import { settleAiGatewayJobCredits, settlementMetadataPatch } from '../settlement.js';
import { maybeAutoPauseAiGatewayProvider } from '../ops-control.js';
import {
  extractAiGatewayArtifactsFromProxyResult,
  sanitizeProxyResultForAiGatewayJob,
} from '../../ai-worker-proxy-usage.js';

const directDispatcher = new Agent();

function publicErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'AI Gateway execution failed');
}

function errorCauseMetadata(error) {
  const cause = error && typeof error === 'object' ? error.cause : null;
  if (!cause || typeof cause !== 'object') return null;
  const out = {};
  for (const key of ['code', 'errno', 'syscall', 'address', 'port']) {
    if (cause[key] != null) out[key] = cause[key];
  }
  if (cause.message) out.message = String(cause.message);
  return Object.keys(out).length ? out : null;
}

function isLoopbackHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function useDirectDispatcherForUrl(targetUrl) {
  try {
    return isLoopbackHost(new URL(targetUrl).hostname);
  } catch {
    return false;
  }
}

function fetchInitWithLoopbackDirect(targetUrl, init) {
  if (!useDirectDispatcherForUrl(targetUrl)) return init;
  return { ...init, dispatcher: directDispatcher };
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
    const fairnessSignature = signFairnessKeyHeader(fairnessKey);
    if (fairnessSignature) headers['X-AC-Fairness-Signature'] = fairnessSignature;
  }

  const gate = creditsGate(plan);
  const reserveKey = String(gate?.reserveKey || '').trim();
  const estimatedCredits = Math.max(1, Math.floor(Number(gate?.estimatedCredits || gate?.reserveAmount || 0)));
  if (userId && reserveKey && estimatedCredits) {
    Object.assign(headers, creditsProxyHeadersFromSigned(signCreditsGatePayload({ userId, reserveKey, estimatedCredits })));
    if (!headers['X-AC-Credits-Reserve']) headers['X-AC-Credits-Reserve'] = reserveKey;
    const handoffToken = signAiGatewayHandoffToken({
      jobId: plan.job?.id,
      userId,
      reserveKey,
      estimatedCredits,
    });
    if (handoffToken) headers[AI_GATEWAY_HANDOFF_HEADER] = handoffToken;
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

async function adapterBodyForExecution(plan, options = {}) {
  const body = { ...(plan.adapterRequest?.body || {}) };
  const providerId = String(plan.route?.providerId || plan.job?.provider || '').trim();
  const needsAgentPlatformKey = providerId === 'vertex-site' && body.aiBackend === 'vertex';
  if (!needsAgentPlatformKey || body.agentPlatformApiKey) return body;

  const acquireKey = options.acquireProviderKey || acquireProviderKey;
  const key = await acquireKey('vertex-site');
  const secret = String(key?.secret || key?.credentials?.apiKey || '').trim();
  if (!secret) {
    throw new Error('No enabled Google Agent Platform API key in AI Gateway provider key pool');
  }
  body.agentPlatformApiKey = secret;
  body.agentPlatformProviderKeyId = key.id;
  return body;
}

function isRetryableHandoffError(error) {
  const name = String(error?.name || '');
  const message = String(error?.message || error || '').toLowerCase();
  const causeCode = String(error?.cause?.code || '').toLowerCase();
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    causeCode === 'econnreset' ||
    causeCode === 'econnrefused' ||
    causeCode === 'etimedout' ||
    causeCode === 'eai_again' ||
    message.includes('fetch failed') ||
    message.includes('connection terminated') ||
    message.includes('socket hang up')
  );
}

function isRetryableHandoffFailure(error) {
  if (isRetryableHandoffError(error)) return true;
  const message = String(error?.message || error || '');
  return /HTTP\s+(429|502|503|504)\b/i.test(message);
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
  const configured = Number(options.handoffRetryDelayMs ?? process.env.AI_GATEWAY_PROXY_HANDOFF_RETRY_DELAY_MS ?? 4000);
  const baseMs = Number.isFinite(configured) ? Math.max(0, configured) : 4000;
  const jitterMs = Number(options.handoffRetryJitterMs ?? process.env.AI_GATEWAY_PROXY_HANDOFF_RETRY_JITTER_MS ?? 1000);
  const retryAfter = retryAfterMs(response);
  const delayMs = Math.min(30_000, Math.max(retryAfter, baseMs * Math.max(1, attempt) + Math.floor(Math.random() * Math.max(0, jitterMs))));
  if (delayMs > 0) await pollDelay(delayMs);
}

function deferredHandoffDelayMs(attempt, options = {}) {
  const configured = Number(options.deferredHandoffDelayMs ?? process.env.AI_GATEWAY_PROXY_DEFERRED_HANDOFF_DELAY_MS ?? 15_000);
  const baseMs = Number.isFinite(configured) ? Math.max(0, configured) : 15_000;
  const jitterMs = Number(options.deferredHandoffJitterMs ?? process.env.AI_GATEWAY_PROXY_DEFERRED_HANDOFF_JITTER_MS ?? 3000);
  return Math.min(60_000, baseMs * Math.max(1, attempt) + Math.floor(Math.random() * Math.max(0, jitterMs)));
}

function scheduleDeferredHandoff(plan, options = {}) {
  const attempt = Math.max(0, Math.floor(Number(options.deferredHandoffAttempt || 0))) + 1;
  const maxAttempts = Math.max(0, Math.floor(Number(options.deferredHandoffMaxAttempts ?? process.env.AI_GATEWAY_PROXY_DEFERRED_HANDOFF_MAX_ATTEMPTS ?? 12)));
  if (attempt > maxAttempts) return false;
  const delayMs = deferredHandoffDelayMs(attempt, options);
  const timer = setTimeout(() => {
    void startAiWorkerProxyExecution(plan, {
      ...options,
      deferredHandoffAttempt: attempt,
    });
  }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { attempt, maxAttempts, delayMs };
}

async function waitForProxyHealth(fetchImpl, options = {}) {
  if (options.handoffHealthProbe === false) return;
  const base = aiWorkerProxyUpstreamBase();
  if (!/^https?:\/\//i.test(base)) return;

  const timeoutMs = Math.max(0, Number(options.handoffHealthProbeTimeoutMs ?? process.env.AI_GATEWAY_PROXY_HANDOFF_HEALTH_TIMEOUT_MS ?? 75_000));
  if (!timeoutMs) return;
  const intervalMs = Math.max(500, Number(options.handoffHealthProbeIntervalMs ?? process.env.AI_GATEWAY_PROXY_HANDOFF_HEALTH_INTERVAL_MS ?? 5000));
  const requestTimeoutMs = Math.max(1000, Number(options.handoffHealthProbeRequestTimeoutMs ?? process.env.AI_GATEWAY_PROXY_HANDOFF_HEALTH_REQUEST_TIMEOUT_MS ?? 12_000));
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `${base}/healthz`;

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(healthUrl, fetchInitWithLoopbackDirect(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(requestTimeoutMs),
      }));
      if (response?.ok) {
        await response.arrayBuffer().catch(() => null);
        return;
      }
      await response?.arrayBuffer?.().catch(() => null);
    } catch {
      // Worker may be cold-starting or switching instances. Keep probing until the deadline.
    }
    await pollDelay(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
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
      const pollUrl = proxyPollUrl(plan, proxyJobId);
      const response = await fetchImpl(pollUrl, fetchInitWithLoopbackDirect(pollUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(Number(options.pollRequestTimeoutMs || 15_000)),
      }));
      const text = await response.text();
      if (!response.ok) continue;
      const body = JSON.parse(text || '{}');
      const status = String(body.status || '').trim();
      if (status === 'completed') {
        const result = body.result ?? null;
        const artifacts = extractAiGatewayArtifactsFromProxyResult(result);
        if (!artifacts.length) {
          const { plan: failed } = await applyAiGatewayAdapterResult(
            plan,
            {
              status: 'failed',
              upstreamTaskId: proxyJobId,
              output: { raw: { proxyResult: sanitizeProxyResultForAiGatewayJob(result) } },
              failureReason: {
                code: 'AI_GATEWAY_UPSTREAM_EMPTY_IMAGE',
                message: 'AI Worker Proxy completed without image artifacts',
              },
            },
            store,
            {
              modality: plan.job?.modality,
              metadata: {
                proxyJobId,
                proxyStatus: 'completed_empty',
                gatewayExecution: { failedAt: new Date().toISOString() },
              },
            }
          );
          current = await settleIfNeeded(failed, store);
          throwIfAdapterPlanTerminalFailed(current, {
            providerId: plan.route?.providerId || plan.job?.provider,
            adapterId: plan.route?.adapterId,
            workerId: plan.route?.workerId,
          });
          return;
        }
        const { plan: succeeded } = await applyAiGatewayAdapterResult(
          plan,
          {
            status: 'succeeded',
            upstreamTaskId: proxyJobId,
            artifacts,
            output: sanitizeProxyResultForAiGatewayJob(result),
          },
          store,
          {
            modality: plan.job?.modality,
            metadata: {
              proxyJobId,
              proxyStatus: 'completed',
              gatewayExecution: { completedAt: new Date().toISOString() },
            },
          }
        );
        current = await settleIfNeeded(succeeded, store);
        throwIfAdapterPlanTerminalFailed(current, {
          providerId: plan.route?.providerId || plan.job?.provider,
          adapterId: plan.route?.adapterId,
          workerId: plan.route?.workerId,
        });
        return;
      }
      if (status === 'failed') {
        const { plan: failed } = await applyAiGatewayAdapterResult(
          plan,
          {
            status: 'failed',
            upstreamTaskId: proxyJobId,
            error: { code: 'AI_WORKER_PROXY_ASYNC_FAILED', message: String(body.error || 'AI Worker Proxy job failed') },
          },
          store,
          {
            metadata: {
              proxyJobId,
              proxyStatus: 'failed',
              gatewayExecution: { failedAt: new Date().toISOString() },
            },
          }
        );
        current = await settleIfNeeded(failed, store);
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

  const { plan: failed } = await applyAiGatewayAdapterResult(
    plan,
    {
      status: 'failed',
      upstreamTaskId: proxyJobId,
      error: {
        code: 'AI_WORKER_PROXY_POLL_TIMEOUT',
        message: 'AI Worker Proxy job polling timed out',
      },
    },
    store,
    {
      metadata: {
        proxyJobId,
        proxyStatus: current?.job?.metadata?.proxyStatus || 'timeout',
        gatewayExecution: {
          failedAt: new Date().toISOString(),
          timeoutMs,
        },
      },
    }
  );
  await settleIfNeeded(failed, store);
}

export async function startAiWorkerProxyExecution(plan, options = {}) {
  const store = options.store;
  const fetchImpl = options.fetchImpl || undiciFetch;
  const targetUrl = `${aiWorkerProxyUpstreamBase()}${plan.adapterRequest.path}`;

  try {
    const maxRetries = Math.max(0, Math.floor(Number(options.handoffRetries ?? process.env.AI_GATEWAY_PROXY_HANDOFF_RETRIES ?? 5)));
    let response = null;
    let text = '';
    let lastError = null;
    const requestBody = await adapterBodyForExecution(plan, options);
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        response = await fetchImpl(targetUrl, fetchInitWithLoopbackDirect(targetUrl, {
          method: plan.adapterRequest.method || 'POST',
          headers: executionHeaders(plan, options),
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(Number(options.timeoutMs || process.env.AI_GATEWAY_EXECUTION_START_TIMEOUT_MS || 45_000)),
        }));
        text = await response.text();
        if (response.ok) break;
        lastError = new Error(`AI Worker Proxy rejected AI job handoff: HTTP ${response.status} ${text.slice(0, 300)}`);
        if (!isRetryableHandoffStatus(response.status) || attempt >= maxRetries) {
          throw lastError;
        }
      } catch (error) {
        lastError = error;
        if (!isRetryableHandoffError(error) || attempt >= maxRetries) {
          throw error;
        }
      }
      if ((response && response.status >= 502) || isRetryableHandoffError(lastError)) {
        await waitForProxyHealth(options.healthFetchImpl || undiciFetch, options);
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
      ? await store.update(plan.job.id, { status: proxy.status === 'queued' ? 'queued' : 'running', error: null, metadata })
      : plan;
    if (!options.disableBackgroundPoll) {
      const pollPromise = pollAiWorkerProxyJob(next || plan, proxy.jobId, options);
      if (options.awaitBackgroundPoll) await pollPromise;
      else void pollPromise;
    }
    return { started: true, upstreamJobId: proxy.jobId, proxyJobId: proxy.jobId, proxyStatus: proxy.status, plan: next || plan };
  } catch (error) {
    if (options.deferRetryableHandoff !== false && isRetryableHandoffFailure(error)) {
      const now = new Date().toISOString();
      const deferred = scheduleDeferredHandoff(plan, options);
      if (deferred && store?.update) {
        const next = await store.update(plan.job.id, {
          status: 'queued',
          metadata: {
            gatewayExecution: {
              deferredAt: now,
              lastHandoffError: publicErrorMessage(error),
              errorCause: errorCauseMetadata(error),
              targetPath: plan.adapterRequest.path,
              targetUrl,
              deferredAttempt: deferred.attempt,
              deferredMaxAttempts: deferred.maxAttempts,
              nextRetryInMs: deferred.delayMs,
            },
          },
        });
        return { started: false, deferred: true, retryable: true, error, plan: next || plan };
      }
    }
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
        errorCause: errorCauseMetadata(error),
        targetPath: plan.adapterRequest.path,
        targetUrl,
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
      ? (await applyAiGatewayAdapterResult(
          plan,
          {
            status: 'failed',
            error: { code: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED', message: publicErrorMessage(error) },
          },
          store,
          { metadata }
        )).plan
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
