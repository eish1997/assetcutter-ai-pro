import { AiGatewayValidationError } from '../job.js';
import { acquireProviderKey, recordProviderKeyError, recordProviderKeySuccess } from '../provider-key-store.js';
import {
  isJimengServiceAvailable,
  jimengNotConfiguredBody,
  pollJimengTask,
  submitJimengTask,
} from '../../jimeng-visual-api.js';
import { finalizeAiGatewayTerminalPlan } from '../execution-finalize.js';
import { applyAiGatewayAdapterResult } from '../adapter-result.js';
import { buildProviderTaskUsage, collectByteSize } from '../execution-usage.js';
import {
  modalityDefaultPollTimeoutMs,
  normalizeAiGatewayAsyncStatus,
  runAiGatewayAsyncPollLoop,
} from '../async-poll.js';

export const JIMENG_VISUAL_DEFAULT_VIDEO_REGISTRY_ID = 'jimeng-video-ti2v-v30-pro';
export const JIMENG_VISUAL_DEFAULT_IMAGE_REGISTRY_ID = 'jimeng-image-t2i-v40';
const JIMENG_PROVIDER_ID = 'volcengine-jimeng';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function publicJimengError(result, fallback = 'Jimeng request failed') {
  const body = result?.body && typeof result.body === 'object' ? result.body : {};
  return (
    nonEmptyString(body.error) ||
    nonEmptyString(body.message) ||
    nonEmptyString(result?.message) ||
    fallback
  );
}

function buildJimengVideoInput(job) {
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const prompt =
    nonEmptyString(input.prompt) ||
    nonEmptyString(input.text) ||
    nonEmptyString(input.contents?.[0]?.parts?.[0]?.text);
  if (!prompt) {
    throw new AiGatewayValidationError('Jimeng video generation requires input.prompt', 'AI_GATEWAY_JIMENG_PROMPT_REQUIRED');
  }
  const registryId =
    nonEmptyString(input.registryId) ||
    nonEmptyString(job?.model) ||
    JIMENG_VISUAL_DEFAULT_VIDEO_REGISTRY_ID;
  const body = {
    registryId,
    prompt,
  };
  for (const key of ['negativePrompt', 'width', 'height', 'aspectRatio', 'referenceImages', 'extra', 'estimatedCredits']) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== '') body[key] = input[key];
  }
  return body;
}

function buildJimengImageInput(job) {
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const prompt =
    nonEmptyString(input.prompt) ||
    nonEmptyString(input.text) ||
    nonEmptyString(input.contents?.[0]?.parts?.[0]?.text);
  if (!prompt) {
    throw new AiGatewayValidationError('Jimeng image generation requires input.prompt', 'AI_GATEWAY_JIMENG_PROMPT_REQUIRED');
  }
  const registryId =
    nonEmptyString(input.registryId) ||
    nonEmptyString(job?.model) ||
    JIMENG_VISUAL_DEFAULT_IMAGE_REGISTRY_ID;
  const config = input.config && typeof input.config === 'object' ? input.config : {};
  const imageConfig = config.imageConfig && typeof config.imageConfig === 'object' ? config.imageConfig : {};
  const body = {
    registryId,
    prompt,
  };
  if (nonEmptyString(imageConfig.aspectRatio) && !input.aspectRatio) body.aspectRatio = nonEmptyString(imageConfig.aspectRatio);
  for (const key of ['negativePrompt', 'width', 'height', 'aspectRatio', 'referenceImages', 'extra', 'estimatedCredits']) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== '') body[key] = input[key];
  }
  return body;
}

export function buildJimengImageWorkerRequest(job, route) {
  if (route?.adapterId !== 'jimeng-visual') {
    throw new AiGatewayValidationError(`Unsupported adapter for Jimeng image: ${route?.adapterId || ''}`);
  }
  return {
    method: 'POST',
    path: '/api/jimeng/tasks',
    providerBaseUrl: 'same-origin',
    body: buildJimengImageInput(job),
    headers: {
      'content-type': 'application/json',
      'x-ac-task-envelope': job.id,
      'x-ac-correlation-id': job.correlationId,
    },
  };
}

export function buildJimengVideoWorkerRequest(job, route) {
  if (route?.adapterId !== 'jimeng-visual') {
    throw new AiGatewayValidationError(`Unsupported adapter for Jimeng video: ${route?.adapterId || ''}`);
  }
  return {
    method: 'POST',
    path: '/api/jimeng/tasks',
    providerBaseUrl: 'same-origin',
    body: buildJimengVideoInput(job),
    headers: {
      'content-type': 'application/json',
      'x-ac-task-envelope': job.id,
      'x-ac-correlation-id': job.correlationId,
    },
  };
}

async function failJimengPoll(plan, store, taskId, registryId, error, extraMeta = {}) {
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
        jimengTaskId: taskId,
        jimengRegistryId: registryId,
        gatewayExecution: { failedAt: new Date().toISOString(), ...extraMeta },
      },
    }
  );
  await finalizeAiGatewayTerminalPlan(failed, store);
}

async function pollJimengVideoTask(plan, taskId, registryId, options = {}) {
  const store = options.store;
  if (!store?.update || !plan?.job?.id || !taskId) return;
  const pollImpl = options.pollJimengTaskImpl || pollJimengTask;
  const startedAtMs = Date.parse(plan.job?.startedAt || '') || Date.now();

  await runAiGatewayAsyncPollLoop({
    pollIntervalMs: options.pollIntervalMs ?? process.env.AI_GATEWAY_JIMENG_POLL_INTERVAL_MS ?? 5000,
    pollTimeoutMs:
      options.pollTimeoutMs ?? process.env.AI_GATEWAY_JIMENG_POLL_TIMEOUT_MS ?? modalityDefaultPollTimeoutMs('video'),
    intervalFloorMs: 2000,
    timeoutCode: 'AI_GATEWAY_ASYNC_POLL_TIMEOUT',
    timeoutMessage: 'Jimeng video async poll timed out',
    async tick() {
      const result = await pollImpl(taskId, registryId, {
        userId: plan.job.userId || null,
        ...(options.credentials ? { credentials: options.credentials } : {}),
      });
      if (!result?.ok) {
        await failJimengPoll(plan, store, taskId, registryId, {
          code: result?.body?.code || 'JIMENG_POLL_FAILED',
          message: publicJimengError(result, 'Jimeng video poll failed'),
        });
        return { done: true };
      }
      const body = result.body && typeof result.body === 'object' ? result.body : {};
      const status = normalizeAiGatewayAsyncStatus(body.status);
      if (status === 'succeeded') {
        const videoUrl = nonEmptyString(body.videoUrl) || nonEmptyString(body.video_url);
        if (!videoUrl) {
          await failJimengPoll(plan, store, taskId, registryId, {
            code: 'JIMENG_VIDEO_URL_MISSING',
            message: 'Jimeng video task completed without videoUrl',
          });
          return { done: true };
        }
        const completedAtMs = Date.now();
        const outputBytes = collectByteSize(body.raw || body);
        const usage = buildProviderTaskUsage(plan, {
          provider: 'volcengine-jimeng',
          upstreamTaskId: taskId,
          billingSku: 'video.jimeng.task',
          meterKind: 'second',
          unit: 'second',
          quantity: positiveNumber(plan.job?.input?.durationSeconds || plan.job?.input?.duration || body.duration || 1, 1),
          outputBytes,
          artifactCount: 1,
          startedAtMs,
          completedAtMs,
        });
        const { plan: succeeded } = await applyAiGatewayAdapterResult(
          plan,
          {
            status: 'succeeded',
            upstreamTaskId: taskId,
            artifacts: [
              {
                kind: 'video',
                url: videoUrl,
                source: 'volcengine-jimeng',
                taskId,
                registryId,
                billing: {
                  actualCredits: usage.actualCredits,
                  settlementSource: usage.settlementSource,
                },
              },
            ],
            usage,
            output: {
              provider: 'volcengine-jimeng',
              taskId,
              registryId,
              videoUrl,
              raw: body.raw || body,
            },
          },
          store,
          {
            metadata: {
              jimengTaskId: taskId,
              jimengRegistryId: registryId,
              gatewayExecution: {
                completedAt: new Date(completedAtMs).toISOString(),
                durationMs: usage.durationMs,
                outputBytes,
                artifactCount: 1,
              },
            },
          }
        );
        await finalizeAiGatewayTerminalPlan(succeeded, store);
        return { done: true };
      }
      if (status === 'failed' || status === 'cancelled') {
        await failJimengPoll(plan, store, taskId, registryId, {
          code: body.code || 'JIMENG_TASK_FAILED',
          message: nonEmptyString(body.message) || `Jimeng video task ${status}`,
        });
        return { done: true };
      }
      await store.update(plan.job.id, {
        status: status === 'queued' ? 'queued' : 'running',
        metadata: {
          jimengTaskId: taskId,
          upstreamTaskId: taskId,
          jimengRegistryId: registryId,
          jimengStatus: status || 'pending',
          ...(body.progress != null ? { jimengProgress: Number(body.progress) } : {}),
        },
      });
      return { done: false };
    },
    async onTimeout({ code, message, timeoutMs }) {
      await failJimengPoll(
        plan,
        store,
        taskId,
        registryId,
        { code, message: `${message} (${timeoutMs}ms)` },
        { pollTimeoutMs: timeoutMs }
      );
    },
  });
}

async function pollJimengImageTask(plan, taskId, registryId, options = {}) {
  const store = options.store;
  if (!store?.update || !plan?.job?.id || !taskId) return;
  const pollImpl = options.pollJimengTaskImpl || pollJimengTask;
  const startedAtMs = Date.parse(plan.job?.startedAt || '') || Date.now();

  await runAiGatewayAsyncPollLoop({
    pollIntervalMs: options.pollIntervalMs ?? process.env.AI_GATEWAY_JIMENG_POLL_INTERVAL_MS ?? 5000,
    pollTimeoutMs:
      options.pollTimeoutMs ??
      process.env.AI_GATEWAY_JIMENG_IMAGE_POLL_TIMEOUT_MS ??
      modalityDefaultPollTimeoutMs('image'),
    intervalFloorMs: 2000,
    timeoutCode: 'AI_GATEWAY_ASYNC_POLL_TIMEOUT',
    timeoutMessage: 'Jimeng image async poll timed out',
    async tick() {
      const result = await pollImpl(taskId, registryId, {
        userId: plan.job.userId || null,
        ...(options.credentials ? { credentials: options.credentials } : {}),
      });
      if (!result?.ok) {
        await failJimengPoll(plan, store, taskId, registryId, {
          code: result?.body?.code || 'JIMENG_POLL_FAILED',
          message: publicJimengError(result, 'Jimeng image poll failed'),
        });
        return { done: true };
      }
      const body = result.body && typeof result.body === 'object' ? result.body : {};
      const status = normalizeAiGatewayAsyncStatus(body.status);
      if (status === 'succeeded') {
        const images = Array.isArray(body.images) ? body.images.filter((url) => nonEmptyString(url)) : [];
        if (!images.length) {
          await failJimengPoll(plan, store, taskId, registryId, {
            code: 'JIMENG_IMAGE_URL_MISSING',
            message: 'Jimeng image task completed without image output',
          });
          return { done: true };
        }
        const completedAtMs = Date.now();
        const outputBytes = collectByteSize(body.raw || body);
        const usage = buildProviderTaskUsage(plan, {
          provider: 'volcengine-jimeng',
          upstreamTaskId: taskId,
          billingSku: 'image.jimeng.task',
          meterKind: 'image',
          unit: 'image',
          quantity: Math.max(1, images.length),
          outputBytes,
          artifactCount: images.length,
          startedAtMs,
          completedAtMs,
        });
        const artifacts = images.map((url) => ({
          kind: 'image',
          url,
          source: 'volcengine-jimeng',
          taskId,
          registryId,
          billing: {
            actualCredits: usage.actualCredits,
            settlementSource: usage.settlementSource,
          },
        }));
        const { plan: succeeded } = await applyAiGatewayAdapterResult(
          plan,
          {
            status: 'succeeded',
            upstreamTaskId: taskId,
            artifacts,
            usage,
            output: {
              provider: 'volcengine-jimeng',
              taskId,
              registryId,
              images,
              raw: body.raw || body,
            },
          },
          store,
          {
            metadata: {
              jimengTaskId: taskId,
              jimengRegistryId: registryId,
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
        await failJimengPoll(plan, store, taskId, registryId, {
          code: body.code || 'JIMENG_TASK_FAILED',
          message: nonEmptyString(body.message) || `Jimeng image task ${status}`,
        });
        return { done: true };
      }
      await store.update(plan.job.id, {
        status: status === 'queued' ? 'queued' : 'running',
        metadata: {
          jimengTaskId: taskId,
          upstreamTaskId: taskId,
          jimengRegistryId: registryId,
          jimengStatus: status || 'pending',
          ...(body.progress != null ? { jimengProgress: Number(body.progress) } : {}),
        },
      });
      return { done: false };
    },
    async onTimeout({ code, message, timeoutMs }) {
      await failJimengPoll(
        plan,
        store,
        taskId,
        registryId,
        { code, message: `${message} (${timeoutMs}ms)` },
        { pollTimeoutMs: timeoutMs }
      );
    },
  });
}

export async function cancelJimengVideoExecution(plan) {
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  const upstreamTaskId = nonEmptyString(metadata.upstreamTaskId) || nonEmptyString(metadata.jimengTaskId);
  return {
    cancelled: false,
    mode: 'soft',
    reason: 'jimeng_hard_cancel_unavailable',
    upstreamTaskId: upstreamTaskId || null,
    provider: JIMENG_PROVIDER_ID,
  };
}

export const cancelJimengImageExecution = cancelJimengVideoExecution;

async function startJimengExecution(plan, options = {}, defaultRegistryId, pollTask) {
  const isAvailable = options.isJimengServiceAvailableImpl || isJimengServiceAvailable;
  const key = options.providerKey || (await acquireProviderKey(JIMENG_PROVIDER_ID));
  const rawCredentials = key?.credentials && typeof key.credentials === 'object' ? key.credentials : null;
  const hasCredentials = Boolean(nonEmptyString(rawCredentials?.accessKeyId) && nonEmptyString(rawCredentials?.secretAccessKey));
  const credentials = hasCredentials ? rawCredentials : null;
  if (!hasCredentials && !isAvailable()) {
    const body = jimengNotConfiguredBody();
    throw new AiGatewayValidationError(body.error || 'Jimeng API is not configured or enabled', body.code || 'JIMENG_NOT_CONFIGURED');
  }
  const submitImpl = options.submitJimengTaskImpl || submitJimengTask;
  const requestBody = plan.workerRequest?.body || plan.adapterRequest?.body || {};
  const registryId = nonEmptyString(requestBody.registryId) || defaultRegistryId;
  const requestOptions = hasCredentials ? { credentials } : {};
  const result = await submitImpl(requestBody, requestOptions);
  if (!result?.ok) {
    const err = new Error(`Jimeng rejected AI job handoff: HTTP ${result?.status || 502} ${publicJimengError(result)}`);
    if (key?.id) recordProviderKeyError(key.id, err, {
      status: result?.status || 502,
      cooldownMs: result?.status === 429 || result?.status >= 500 ? 60_000 : 0,
      reason: `Jimeng HTTP ${result?.status || 502}`,
    });
    throw err;
  }
  if (key?.id) recordProviderKeySuccess(key.id);
  const taskId = nonEmptyString(result.taskId);
  if (!taskId) throw new Error('Jimeng did not return taskId');

  const metadata = {
    gatewayExecution: {
      startedAt: new Date().toISOString(),
      targetPath: plan.workerRequest?.path || plan.adapterRequest?.path || '/api/jimeng/tasks',
      providerKeyId: key?.id || null,
    },
    jimengTaskId: taskId,
    upstreamTaskId: taskId,
    jimengRegistryId: registryId,
  };
  const next = options.store?.update
    ? await options.store.update(plan.job.id, { status: 'queued', metadata })
    : plan;
  if (!options.disableBackgroundPoll) {
    const pollPromise = pollTask(next || plan, taskId, registryId, {
      ...options,
      credentials,
      pollIntervalMs: positiveNumber(options.pollIntervalMs, undefined),
      pollTimeoutMs: positiveNumber(options.pollTimeoutMs, undefined),
    });
    if (options.awaitBackgroundPoll) await pollPromise;
    else void pollPromise;
  }
  return { started: true, upstreamJobId: taskId, jimengTaskId: taskId, plan: next || plan };
}

export async function startJimengImageExecution(plan, options = {}) {
  return startJimengExecution(plan, options, JIMENG_VISUAL_DEFAULT_IMAGE_REGISTRY_ID, pollJimengImageTask);
}

export async function startJimengVideoExecution(plan, options = {}) {
  return startJimengExecution(plan, options, JIMENG_VISUAL_DEFAULT_VIDEO_REGISTRY_ID, pollJimengVideoTask);
}
