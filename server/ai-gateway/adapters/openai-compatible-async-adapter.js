import { fetch as undiciFetch } from 'undici';
import { AiGatewayValidationError } from '../job.js';
import { finalizeAiGatewayTerminalPlan } from '../execution-finalize.js';
import { applyAiGatewayAdapterResult } from '../adapter-result.js';
import { buildProviderTaskUsage, collectByteSize } from '../execution-usage.js';
import { normalizeGatewayInput } from '../gateway-input.js';
import { defaultOpenAiCompatibleBaseUrl, normalizeOpenAiCompatibleBaseUrl, openAiCompatibleProviderLabel, openAiCompatibleTimeoutsForProvider } from '../openai-compatible-config.js';
import { acquireProviderKey, recordProviderKeyError, recordProviderKeySuccess } from '../provider-key-store.js';

const ADAPTER_ID = 'openai-compatible-async';
const REQUIRED_MAPPING_FIELDS = Object.freeze(['requestPath', 'pollPath', 'statusPath', 'artifactPath']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getPath(obj, path) {
  const raw = nonEmptyString(path);
  if (!raw) return undefined;
  return raw.split('.').reduce((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(key)) return acc[Number(key)];
    return acc[key];
  }, obj);
}

function valuesFromPath(obj, path) {
  const value = getPath(obj, path);
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function normalizeEndpointMapping(route) {
  const raw = route?.endpointMapping && typeof route.endpointMapping === 'object' ? route.endpointMapping : {};
  const missing = REQUIRED_MAPPING_FIELDS.filter((field) => !nonEmptyString(raw[field]));
  if (missing.length) {
    throw new AiGatewayValidationError(
      `OpenAI-compatible async route is missing endpoint mapping fields: ${missing.join(', ')}`,
      'AI_GATEWAY_ASYNC_ENDPOINT_MAPPING_REQUIRED',
      { missingEndpointFields: missing }
    );
  }
  return {
    method: nonEmptyString(raw.method).toUpperCase() || 'POST',
    requestPath: nonEmptyString(raw.requestPath),
    pollPath: nonEmptyString(raw.pollPath),
    statusPath: nonEmptyString(raw.statusPath),
    artifactPath: nonEmptyString(raw.artifactPath),
    taskIdPath: nonEmptyString(raw.taskIdPath) || 'id',
    errorPath: nonEmptyString(raw.errorPath) || 'error.message',
  };
}

function normalizeAsyncStatus(value) {
  const s = String(value || '').trim().toLowerCase();
  if (['queued', 'pending', 'created', 'submitted', 'waiting'].includes(s)) return 'queued';
  if (['running', 'processing', 'in_progress', 'generating'].includes(s)) return 'running';
  if (['succeeded', 'success', 'finished', 'done', 'completed'].includes(s)) return 'succeeded';
  if (['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(s)) return 'failed';
  return 'running';
}

function extractTaskId(data, mapping) {
  return (
    nonEmptyString(getPath(data, mapping.taskIdPath)) ||
    nonEmptyString(data?.id) ||
    nonEmptyString(data?.task_id) ||
    nonEmptyString(data?.taskId) ||
    nonEmptyString(data?.data?.id) ||
    nonEmptyString(data?.data?.task_id) ||
    nonEmptyString(data?.data?.taskId)
  );
}

function interpolatePath(path, taskId) {
  const encoded = encodeURIComponent(taskId);
  return nonEmptyString(path)
    .replace(/\{taskId\}/g, encoded)
    .replace(/\{task_id\}/g, encoded)
    .replace(/\{id\}/g, encoded);
}

function joinBaseUrlAndPath(baseUrl, requestPath) {
  const base = nonEmptyString(baseUrl).replace(/\/+$/, '');
  const path = nonEmptyString(requestPath);
  if (/\/v1$/i.test(base) && /^\/v1(\/|$)/i.test(path)) return `${base}${path.slice(3) || '/'}`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function buildAsyncBody(job) {
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const gatewayInput = normalizeGatewayInput(job);
  const prompt = gatewayInput.prompt;
  if (!prompt) {
    throw new AiGatewayValidationError('OpenAI-compatible async generation requires input.prompt', 'AI_GATEWAY_ASYNC_PROMPT_REQUIRED');
  }
  const body = {
    model: nonEmptyString(input.upstreamModelId || input.model || job?.model),
    prompt,
    reference_images: gatewayInput.referenceImages,
    metadata: {
      canonicalModelId: nonEmptyString(input.canonicalModelId || input.registryId || job?.model) || null,
      modality: job?.modality || null,
      capability: job?.capability || null,
    },
  };
  if (job?.modality === 'video') {
    if (gatewayInput.durationSeconds) body.duration = gatewayInput.durationSeconds;
    if (gatewayInput.aspectRatio) body.aspect_ratio = gatewayInput.aspectRatio;
    if (gatewayInput.resolution) body.resolution = gatewayInput.resolution;
    if (gatewayInput.seed !== null) body.seed = gatewayInput.seed;
  }
  if (job?.modality === 'model3d') {
    if (gatewayInput.format) body.format = gatewayInput.format;
    if (gatewayInput.quality) body.quality = gatewayInput.quality;
    if (gatewayInput.texture !== null) body.texture = gatewayInput.texture;
    if (gatewayInput.seed !== null) body.seed = gatewayInput.seed;
  }
  return body;
}

export function buildOpenAiCompatibleAsyncWorkerRequest(job, route) {
  if (route?.adapterId !== ADAPTER_ID) {
    throw new AiGatewayValidationError(`Unsupported adapter for OpenAI-compatible async task: ${route?.adapterId || ''}`);
  }
  const mapping = normalizeEndpointMapping(route);
  return {
    method: mapping.method,
    path: mapping.requestPath,
    pollPath: mapping.pollPath,
    providerBaseUrl: defaultOpenAiCompatibleBaseUrl(route?.providerId),
    body: buildAsyncBody(job),
    endpointMapping: mapping,
    headers: {
      'content-type': 'application/json',
      'x-ac-task-envelope': job.id,
      'x-ac-correlation-id': job.correlationId,
    },
  };
}

async function readJsonSafe(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function asyncErrorMessage(data, mapping, fallback = 'OpenAI-compatible async request failed') {
  return (
    nonEmptyString(getPath(data, mapping?.errorPath)) ||
    nonEmptyString(data?.error?.message) ||
    nonEmptyString(data?.message) ||
    nonEmptyString(data?.error) ||
    fallback
  );
}

function artifactKind(modality) {
  return modality === 'model3d' ? 'model3d' : 'video';
}

function extractArtifactUrls(data, mapping) {
  return valuesFromPath(data, mapping.artifactPath)
    .map((value) => nonEmptyString(value?.url || value?.publicUrl || value))
    .filter(Boolean);
}

function pollDelay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

async function pollOpenAiCompatibleAsyncTask(plan, taskId, key, mapping, options = {}) {
  const store = options.store;
  if (!store?.update || !plan?.job?.id || !taskId) return;
  const fetchImpl = options.fetchImpl || undiciFetch;
  const providerId = nonEmptyString(plan?.route?.providerId) || nonEmptyString(key?.provider);
  const providerLabel = openAiCompatibleProviderLabel(providerId);
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(key?.credentials?.baseUrl, providerId);
  const timeouts = openAiCompatibleTimeoutsForProvider(providerId);
  const intervalFloorMs = options.pollIntervalMs != null ? 1 : 3000;
  const intervalMs = Math.max(
    intervalFloorMs,
    Number(options.pollIntervalMs || process.env.AI_GATEWAY_OPENAI_COMPAT_ASYNC_POLL_INTERVAL_MS || timeouts.pollIntervalMs || 5000)
  );
  const timeoutMs = Math.max(
    intervalMs,
    Number(options.pollTimeoutMs || process.env.AI_GATEWAY_OPENAI_COMPAT_ASYNC_POLL_TIMEOUT_MS || timeouts.pollTimeoutMs || 900_000)
  );
  const startedAt = Date.now();
  const startedAtMs = Date.parse(plan.job?.startedAt || '') || startedAt;

  while (Date.now() - startedAt < timeoutMs) {
    await pollDelay(intervalMs);
    const response = await fetchImpl(joinBaseUrlAndPath(baseUrl, interpolatePath(mapping.pollPath, taskId)), {
      method: 'GET',
      headers: { Authorization: `Bearer ${key.secret}` },
      signal: AbortSignal.timeout(Number(options.pollRequestTimeoutMs || timeouts.pollRequestMs || 30_000)),
    });
    const data = await readJsonSafe(response);
    if (!response.ok) continue;
    const status = normalizeAsyncStatus(getPath(data, mapping.statusPath));
    if (status === 'succeeded') {
      const completedAtMs = Date.now();
      const urls = extractArtifactUrls(data, mapping);
      if (!urls.length) {
        const { plan: failed } = await applyAiGatewayAdapterResult(
          plan,
          {
            status: 'failed',
            upstreamTaskId: taskId,
            error: { code: 'OPENAI_COMPAT_ASYNC_ARTIFACT_MISSING', message: `${providerLabel} async task completed without artifact URL` },
          },
          store,
          { metadata: { gatewayExecution: { failedAt: new Date().toISOString() } } }
        );
        await finalizeAiGatewayTerminalPlan(failed, store);
        return;
      }
      const usage = buildProviderTaskUsage(plan, {
        provider: providerId,
        upstreamTaskId: taskId,
        meterKind: plan.job?.modality === 'model3d' ? 'task' : 'second',
        unit: plan.job?.modality === 'model3d' ? 'task' : 'second',
        quantity: plan.job?.modality === 'model3d' ? 1 : Number(plan.job?.input?.durationSeconds || plan.job?.input?.duration || 1),
        outputBytes: collectByteSize(data),
        artifactCount: urls.length,
        startedAtMs,
        completedAtMs,
      });
      const kind = artifactKind(plan.job?.modality);
      const artifacts = urls.map((url) => ({
        kind,
        url,
        source: providerId,
        taskId,
        registryId: plan.job?.model || null,
        billing: { actualCredits: usage.actualCredits, settlementSource: usage.settlementSource },
      }));
      const { plan: succeeded } = await applyAiGatewayAdapterResult(
        plan,
        {
          status: 'succeeded',
          upstreamTaskId: taskId,
          artifacts,
          usage,
          output: { provider: providerId, taskId, raw: data },
        },
        store,
        {
          metadata: {
            gatewayExecution: { completedAt: new Date(completedAtMs).toISOString(), durationMs: usage.durationMs, outputBytes: usage.outputBytes },
          },
        }
      );
      await finalizeAiGatewayTerminalPlan(succeeded, store);
      return;
    }
    if (status === 'failed') {
      const { plan: failed } = await applyAiGatewayAdapterResult(
        plan,
        {
          status: 'failed',
          upstreamTaskId: taskId,
          error: { code: data?.code || 'OPENAI_COMPAT_ASYNC_TASK_FAILED', message: asyncErrorMessage(data, mapping, `${providerLabel} async task failed`) },
        },
        store,
        { metadata: { gatewayExecution: { failedAt: new Date().toISOString() } } }
      );
      await finalizeAiGatewayTerminalPlan(failed, store);
      return;
    }
    await store.update(plan.job.id, { status: status === 'queued' ? 'queued' : 'running', metadata: { upstreamTaskId: taskId, asyncStatus: status } });
  }
}

export async function startOpenAiCompatibleAsyncExecution(plan, options = {}) {
  const providerId = nonEmptyString(plan?.route?.providerId);
  const providerLabel = openAiCompatibleProviderLabel(providerId);
  const key = options.providerKey || (await acquireProviderKey(providerId));
  if (!key?.secret) {
    throw new AiGatewayValidationError(`No enabled ${providerLabel} API key in AI Gateway provider key pool`, 'AI_GATEWAY_PROVIDER_KEY_MISSING');
  }
  const request = plan.workerRequest || plan.adapterRequest;
  const mapping = request?.endpointMapping || normalizeEndpointMapping(plan?.route);
  const fetchImpl = options.fetchImpl || undiciFetch;
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(key.credentials?.baseUrl, providerId);
  const response = await fetchImpl(joinBaseUrlAndPath(baseUrl, request.path || mapping.requestPath), {
    method: request.method || 'POST',
    headers: { Authorization: `Bearer ${key.secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body || {}),
    signal: AbortSignal.timeout(Number(options.timeoutMs || key.credentials?.requestTimeoutMs || process.env.AI_GATEWAY_OPENAI_COMPAT_ASYNC_START_TIMEOUT_MS || 60_000)),
  });
  const data = await readJsonSafe(response);
  if (!response.ok) {
    const err = new Error(`${providerLabel} rejected async AI job handoff: HTTP ${response.status} ${asyncErrorMessage(data, mapping)}`);
    recordProviderKeyError(key.id, err, {
      status: response.status,
      cooldownMs: response.status === 429 || response.status >= 500 ? 60_000 : 0,
      reason: `${providerLabel} HTTP ${response.status}`,
    });
    throw err;
  }
  recordProviderKeySuccess(key.id);
  const taskId = extractTaskId(data, mapping);
  if (!taskId) throw new Error(`${providerLabel} async task did not return task id`);
  const metadata = {
    gatewayExecution: {
      startedAt: new Date().toISOString(),
      targetPath: request.path || mapping.requestPath,
      providerKeyId: key.id,
    },
    upstreamTaskId: taskId,
  };
  const updated = options.store?.update ? await options.store.update(plan.job.id, { status: 'queued', metadata }) : plan;
  const next = updated?.job?.id ? updated : updated?.id ? { ...plan, job: updated } : plan;
  if (!options.disableBackgroundPoll) {
    const pollPromise = pollOpenAiCompatibleAsyncTask(next, taskId, key, mapping, options);
    if (options.awaitBackgroundPoll) await pollPromise;
    else void pollPromise;
  }
  return { started: true, upstreamJobId: taskId, plan: next };
}

export async function cancelOpenAiCompatibleAsyncExecution(plan) {
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  return {
    cancelled: false,
    mode: 'soft',
    reason: 'openai_compatible_async_hard_cancel_unavailable',
    upstreamTaskId: nonEmptyString(metadata.upstreamTaskId) || null,
    provider: nonEmptyString(plan?.route?.providerId) || null,
  };
}
