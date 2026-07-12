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

function executionHeaders(plan) {
  const headers = {
    ...(plan.adapterRequest?.headers && typeof plan.adapterRequest.headers === 'object' ? plan.adapterRequest.headers : {}),
  };
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
      headers: executionHeaders(plan),
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
