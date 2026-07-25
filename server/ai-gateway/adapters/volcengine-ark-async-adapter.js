import { fetch as undiciFetch } from 'undici';
import { AiGatewayValidationError } from '../job.js';
import { finalizeAiGatewayTerminalPlan } from '../execution-finalize.js';
import { applyAiGatewayAdapterResult } from '../adapter-result.js';
import { buildProviderTaskUsage, collectByteSize } from '../execution-usage.js';
import { normalizeGatewayInput } from '../gateway-input.js';
import { acquireProviderKey, recordProviderKeyError, recordProviderKeySuccess } from '../provider-key-store.js';
import {
  modalityDefaultPollTimeoutMs,
  normalizeAiGatewayAsyncStatus,
  runAiGatewayAsyncPollLoop,
} from '../async-poll.js';

export const VOLCENGINE_ARK_PROVIDER_ID = 'volcengine-ark';
export const VOLCENGINE_ARK_ASYNC_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const VOLCENGINE_ARK_ASYNC_TASK_PATH = '/contents/generations/tasks';

const ARK_ASYNC_MODEL_MAP = Object.freeze({
  'doubao-seedance-2-0': 'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast': 'doubao-seedance-2-0-fast-260128',
  'doubao-seed3d-2-0': 'doubao-seed3d-2-0-260328',
});

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeBaseUrl(value) {
  return (nonEmptyString(value) || VOLCENGINE_ARK_ASYNC_DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function mapArkAsyncModel(value) {
  const model = nonEmptyString(value);
  if (!model) return '';
  return ARK_ASYNC_MODEL_MAP[model] || model;
}

function buildArkContent(prompt, refs) {
  const content = [];
  if (prompt) content.push({ type: 'text', text: prompt });
  for (const url of refs) content.push({ type: 'image_url', image_url: { url } });
  return content;
}

function copyDefined(source, pairs, target) {
  for (const [from, to = from] of pairs) {
    if (source[from] !== undefined && source[from] !== null && source[from] !== '') target[to] = source[from];
  }
}

function buildArkAsyncInput(job) {
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const gatewayInput = normalizeGatewayInput(job);
  const prompt = gatewayInput.prompt;
  if (!prompt) {
    throw new AiGatewayValidationError('Volcengine Ark async generation requires input.prompt', 'AI_GATEWAY_ARK_PROMPT_REQUIRED');
  }
  const registryId = nonEmptyString(input.registryId) || nonEmptyString(job?.model);
  const model = mapArkAsyncModel(registryId);
  if (!model) {
    throw new AiGatewayValidationError('Volcengine Ark async generation requires a model', 'AI_GATEWAY_ARK_MODEL_REQUIRED');
  }
  const refs = gatewayInput.referenceImages;
  const body = {
    model,
    content: buildArkContent(prompt.slice(0, 32000), refs),
    metadata: {
      canonicalModelId: registryId,
      registryId,
      modality: job?.modality || null,
      capability: job?.capability || null,
    },
  };
  if (job?.modality === 'video') {
    if (gatewayInput.durationSeconds) body.duration = gatewayInput.durationSeconds;
    if (gatewayInput.aspectRatio) body.ratio = gatewayInput.aspectRatio;
    if (gatewayInput.resolution) body.resolution = gatewayInput.resolution;
    if (gatewayInput.seed !== null) body.seed = gatewayInput.seed;
    copyDefined(input, [['motionStrength', 'motion_strength']], body);
  }
  if (job?.modality === 'model3d') {
    if (gatewayInput.quality) body.quality = gatewayInput.quality;
    if (gatewayInput.format) body.format = gatewayInput.format;
    if (gatewayInput.texture !== null) body.texture = gatewayInput.texture;
    if (gatewayInput.seed !== null) body.seed = gatewayInput.seed;
    copyDefined(input, [
      ['geometryQuality', 'geometry_quality'],
      ['textureQuality', 'texture_quality'],
    ], body);
  }
  return body;
}

export function buildVolcengineArkAsyncWorkerRequest(job, route) {
  if (route?.adapterId !== 'volcengine-ark-async') {
    throw new AiGatewayValidationError(`Unsupported adapter for Volcengine Ark async task: ${route?.adapterId || ''}`);
  }
  return {
    method: 'POST',
    path: VOLCENGINE_ARK_ASYNC_TASK_PATH,
    providerBaseUrl: VOLCENGINE_ARK_ASYNC_DEFAULT_BASE_URL,
    body: buildArkAsyncInput(job),
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

function arkErrorMessage(data, fallback = 'Volcengine Ark request failed') {
  return (
    nonEmptyString(data?.error?.message) ||
    nonEmptyString(data?.message) ||
    nonEmptyString(data?.error) ||
    nonEmptyString(data?.msg) ||
    fallback
  );
}

function extractTaskId(data) {
  return (
    nonEmptyString(data?.id) ||
    nonEmptyString(data?.task_id) ||
    nonEmptyString(data?.taskId) ||
    nonEmptyString(data?.data?.id) ||
    nonEmptyString(data?.data?.task_id) ||
    nonEmptyString(data?.data?.taskId)
  );
}

function normalizeArkStatus(data) {
  const raw = data?.status || data?.data?.status || data?.task?.status || '';
  return normalizeAiGatewayAsyncStatus(raw);
}

function collectUrls(data, matcher) {
  const out = [];
  const push = (value, key = '') => {
    const url = nonEmptyString(value);
    if (!/^https?:\/\//i.test(url)) return;
    if (!matcher(url, key)) return;
    if (!out.includes(url)) out.push(url);
  };
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') push(value, key);
      else walk(value);
    }
  };
  walk(data);
  return out;
}

function extractVideoUrl(data) {
  return collectUrls(data, (url, key) => /(video|url|result)/i.test(key) || /\.(mp4|mov|webm)(\?|#|$)/i.test(url))[0] || '';
}

function extractModelUrls(data) {
  return collectUrls(data, (url, key) => /(model|glb|gltf|fbx|obj|usdz|zip|download)/i.test(key) || /\.(glb|gltf|fbx|obj|usdz|zip)(\?|#|$)/i.test(url));
}

async function failArkPoll(plan, store, taskId, error, extraMeta = {}) {
  const { plan: failed } = await applyAiGatewayAdapterResult(
    plan,
    {
      status: 'failed',
      upstreamTaskId: taskId,
      error,
    },
    store,
    {
      metadata: {
        arkTaskId: taskId,
        gatewayExecution: { failedAt: new Date().toISOString(), ...extraMeta },
      },
    }
  );
  await finalizeAiGatewayTerminalPlan(failed, store);
}

async function pollArkAsyncTask(plan, taskId, key, options = {}) {
  const store = options.store;
  if (!store?.update || !plan?.job?.id || !taskId) return;
  const fetchImpl = options.fetchImpl || undiciFetch;
  const baseUrl = normalizeBaseUrl(key?.credentials?.baseUrl);
  const startedAtMs = Date.parse(plan.job?.startedAt || '') || Date.now();
  const model = plan.workerRequest?.body?.model || plan.job?.model || '';
  const modality = plan.job?.modality === 'model3d' ? 'model3d' : 'video';

  await runAiGatewayAsyncPollLoop({
    pollIntervalMs: options.pollIntervalMs ?? process.env.AI_GATEWAY_ARK_ASYNC_POLL_INTERVAL_MS ?? 5000,
    pollTimeoutMs:
      options.pollTimeoutMs ?? process.env.AI_GATEWAY_ARK_ASYNC_POLL_TIMEOUT_MS ?? modalityDefaultPollTimeoutMs(modality),
    pollRequestTimeoutMs: options.pollRequestTimeoutMs,
    intervalFloorMs: 3000,
    timeoutCode: 'AI_GATEWAY_ASYNC_POLL_TIMEOUT',
    timeoutMessage: 'Volcengine Ark async poll timed out',
    async tick() {
      const response = await fetchImpl(`${baseUrl}${VOLCENGINE_ARK_ASYNC_TASK_PATH}/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key.secret}` },
        signal: AbortSignal.timeout(Number(options.pollRequestTimeoutMs || 30_000)),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) return { done: false };
      const status = normalizeArkStatus(data);
      if (status === 'succeeded') {
        const completedAtMs = Date.now();
        const outputBytes = collectByteSize(data);
        const model3d = plan.job?.modality === 'model3d';
        const modelUrls = model3d ? extractModelUrls(data) : [];
        const videoUrl = model3d ? '' : extractVideoUrl(data);
        if (model3d ? modelUrls.length === 0 : !videoUrl) {
          await failArkPoll(plan, store, taskId, {
            code: model3d ? 'ARK_MODEL_URL_MISSING' : 'ARK_VIDEO_URL_MISSING',
            message: model3d
              ? 'Volcengine Ark 3D task completed without model URL'
              : 'Volcengine Ark video task completed without video URL',
          });
          return { done: true };
        }
        const usage = buildProviderTaskUsage(plan, {
          provider: VOLCENGINE_ARK_PROVIDER_ID,
          upstreamTaskId: taskId,
          billingSku: model3d
            ? `model3d.volcengine-ark.${model || 'seed3d'}`
            : `video.volcengine-ark.${model || 'seedance'}`,
          meterKind: model3d ? 'task' : 'second',
          unit: model3d ? 'task' : 'second',
          quantity: model3d
            ? 1
            : positiveNumber(plan.job?.input?.durationSeconds || plan.job?.input?.duration || data?.duration, 1),
          outputBytes,
          artifactCount: model3d ? modelUrls.length : 1,
          startedAtMs,
          completedAtMs,
        });
        const artifacts = model3d
          ? modelUrls.map((url) => ({
              kind: 'model3d',
              url,
              source: VOLCENGINE_ARK_PROVIDER_ID,
              taskId,
              registryId: plan.job?.model || null,
              billing: { actualCredits: usage.actualCredits, settlementSource: usage.settlementSource },
            }))
          : [
              {
                kind: 'video',
                url: videoUrl,
                source: VOLCENGINE_ARK_PROVIDER_ID,
                taskId,
                registryId: plan.job?.model || null,
                billing: { actualCredits: usage.actualCredits, settlementSource: usage.settlementSource },
              },
            ];
        const { plan: succeeded } = await applyAiGatewayAdapterResult(
          plan,
          {
            status: 'succeeded',
            upstreamTaskId: taskId,
            artifacts,
            usage,
            output: {
              provider: VOLCENGINE_ARK_PROVIDER_ID,
              taskId,
              model,
              ...(model3d ? { modelUrls } : { videoUrl }),
              raw: data,
            },
          },
          store,
          {
            metadata: {
              arkTaskId: taskId,
              gatewayExecution: {
                completedAt: new Date(completedAtMs).toISOString(),
                durationMs: usage.durationMs,
                outputBytes,
                artifactCount: artifacts.length,
              },
            },
          }
        );
        await finalizeAiGatewayTerminalPlan(succeeded, store);
        return { done: true };
      }
      if (status === 'failed' || status === 'cancelled') {
        await failArkPoll(plan, store, taskId, {
          code: data?.code || 'ARK_ASYNC_TASK_FAILED',
          message: arkErrorMessage(data, `Volcengine Ark async task ${status}`),
        });
        return { done: true };
      }
      await store.update(plan.job.id, {
        status: status === 'queued' ? 'queued' : 'running',
        metadata: { arkTaskId: taskId, upstreamTaskId: taskId, arkStatus: status },
      });
      return { done: false };
    },
    async onTimeout({ code, message, timeoutMs }) {
      await failArkPoll(
        plan,
        store,
        taskId,
        { code, message: `${message} (${timeoutMs}ms)` },
        { pollTimeoutMs: timeoutMs }
      );
    },
  });
}

export async function cancelVolcengineArkAsyncExecution(plan) {
  const { softAiGatewayCancelResult } = await import('../cancel-result.js');
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  const upstreamTaskId = nonEmptyString(metadata.upstreamTaskId) || nonEmptyString(metadata.arkTaskId);
  return softAiGatewayCancelResult({
    reason: 'volcengine_ark_hard_cancel_unavailable',
    cancelReason: 'volcengine_ark_hard_cancel_unavailable',
    upstreamTaskId: upstreamTaskId || null,
    provider: VOLCENGINE_ARK_PROVIDER_ID,
    adapterId: 'volcengine-ark-async',
  });
}

export async function startVolcengineArkAsyncExecution(plan, options = {}) {
  const key = options.providerKey || (await acquireProviderKey(VOLCENGINE_ARK_PROVIDER_ID));
  if (!key?.secret) {
    throw new AiGatewayValidationError('No enabled Volcengine Ark API key in AI Gateway provider key pool', 'AI_GATEWAY_PROVIDER_KEY_MISSING');
  }
  const fetchImpl = options.fetchImpl || undiciFetch;
  const request = plan.workerRequest || plan.adapterRequest;
  const baseUrl = normalizeBaseUrl(key.credentials?.baseUrl);
  const response = await fetchImpl(`${baseUrl}${request.path || VOLCENGINE_ARK_ASYNC_TASK_PATH}`, {
    method: request.method || 'POST',
    headers: {
      Authorization: `Bearer ${key.secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request.body || {}),
    signal: AbortSignal.timeout(Number(options.timeoutMs || process.env.AI_GATEWAY_ARK_ASYNC_START_TIMEOUT_MS || 60_000)),
  });
  const data = await readJsonSafe(response);
  if (!response.ok) {
    const err = new Error(`Volcengine Ark rejected AI job handoff: HTTP ${response.status} ${arkErrorMessage(data)}`);
    recordProviderKeyError(key.id, err, {
      status: response.status,
      cooldownMs: response.status === 429 || response.status >= 500 ? 60_000 : 0,
      reason: `Volcengine Ark HTTP ${response.status}`,
    });
    throw err;
  }
  recordProviderKeySuccess(key.id);
  const taskId = extractTaskId(data);
  if (!taskId) throw new Error('Volcengine Ark async task did not return task id');
  const metadata = {
    gatewayExecution: {
      startedAt: new Date().toISOString(),
      targetPath: request.path || VOLCENGINE_ARK_ASYNC_TASK_PATH,
      providerKeyId: key.id,
    },
    arkTaskId: taskId,
    upstreamTaskId: taskId,
  };
  const updated = options.store?.update
    ? await options.store.update(plan.job.id, { status: 'queued', metadata })
    : plan;
  const next = updated?.job?.id ? updated : updated?.id ? { ...plan, job: updated } : plan;
  if (!options.disableBackgroundPoll) {
    const pollPromise = pollArkAsyncTask(next, taskId, key, options);
    if (options.awaitBackgroundPoll) await pollPromise;
    else void pollPromise;
  }
  return { started: true, upstreamJobId: taskId, arkTaskId: taskId, plan: next };
}
