import { fetch as undiciFetch } from 'undici';
import { geminiProxyUpstreamBase } from '../gemini-proxy-relay.js';
import { creditsProxyHeadersFromSigned, fairnessKeyForUserId, signCreditsGatePayload } from '../credits-gate-hmac.js';
import { isAiGatewayExecutionEnabled } from './health.js';
import { settleAiGatewayJobCredits, settlementMetadataPatch } from './settlement.js';

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

function proxyPollUrl(plan, proxyJobId) {
  const path = String(plan.adapterRequest?.path || '/proxy/gemini/async').replace(/\/+$/, '');
  return `${geminiProxyUpstreamBase()}${path}/${encodeURIComponent(proxyJobId)}`;
}

async function settleIfNeeded(plan, store) {
  if (!plan || !store?.update) return plan;
  const settlement = await settleAiGatewayJobCredits(plan);
  const settlementMetadata = settlementMetadataPatch(plan, settlement);
  if (!Object.keys(settlementMetadata).length) return plan;
  return store.update(plan.job.id, { metadata: settlementMetadata });
}

async function pollAiGatewayProxyJob(plan, proxyJobId, options = {}) {
  const store = options.store;
  if (!store?.update || !plan?.job?.id || !proxyJobId) return;
  const fetchImpl = options.fetchImpl || undiciFetch;
  const startedAt = Date.now();
  const intervalMs = Math.max(1000, Number(options.pollIntervalMs || process.env.AI_GATEWAY_PROXY_POLL_INTERVAL_MS || 3000));
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
        current = await store.update(plan.job.id, {
          status: 'succeeded',
          output: body.result ?? null,
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
          error: { code: 'GEMINI_PROXY_ASYNC_FAILED', message: String(body.error || 'Gemini proxy job failed') },
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

export async function startAiGatewayJobExecution(plan, options = {}) {
  if (!isAiGatewayExecutionEnabled()) return { started: false, skipped: true, reason: 'execution_disabled', plan };
  if (!plan?.job?.id || !plan?.adapterRequest) {
    return { started: false, skipped: true, reason: 'missing_adapter_request', plan };
  }

  const store = options.store;
  const fetchImpl = options.fetchImpl || undiciFetch;
  const targetUrl = `${geminiProxyUpstreamBase()}${plan.adapterRequest.path}`;

  try {
    const response = await fetchImpl(targetUrl, {
      method: plan.adapterRequest.method || 'POST',
      headers: executionHeaders(plan, options),
      body: JSON.stringify(plan.adapterRequest.body || {}),
      signal: AbortSignal.timeout(Number(options.timeoutMs || process.env.AI_GATEWAY_EXECUTION_START_TIMEOUT_MS || 30_000)),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini proxy rejected AI job handoff: HTTP ${response.status} ${text.slice(0, 300)}`);
    }
    const proxy = parseProxyCreateResponse(text);
    if (!proxy.jobId) throw new Error(`Gemini proxy did not return jobId: ${text.slice(0, 300)}`);

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
      void pollAiGatewayProxyJob(next || plan, proxy.jobId, options);
    }
    return { started: true, proxyJobId: proxy.jobId, proxyStatus: proxy.status, plan: next || plan };
  } catch (error) {
    const metadata = {
      gatewayExecution: {
        failedAt: new Date().toISOString(),
        error: publicErrorMessage(error),
        targetPath: plan.adapterRequest.path,
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
