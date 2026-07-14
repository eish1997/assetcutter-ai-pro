import { AiGatewayValidationError } from '../job.js';
import { acquireProviderKey, recordProviderKeyError, recordProviderKeySuccess } from '../provider-key-store.js';
import {
  isJimengServiceAvailable,
  jimengNotConfiguredBody,
  pollJimengTask,
  submitJimengTask,
} from '../../jimeng-visual-api.js';
import { finalizeAiGatewayTerminalPlan } from '../execution-finalize.js';

export const JIMENG_VISUAL_DEFAULT_VIDEO_REGISTRY_ID = 'jimeng-video-ti2v-v30-pro';
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

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

async function pollJimengVideoTask(plan, taskId, registryId, options = {}) {
  const store = options.store;
  if (!store?.update || !plan?.job?.id || !taskId) return;
  const pollImpl = options.pollJimengTaskImpl || pollJimengTask;
  const intervalFloorMs = options.pollIntervalMs != null ? 1 : 2000;
  const intervalMs = Math.max(intervalFloorMs, Number(options.pollIntervalMs || process.env.AI_GATEWAY_JIMENG_POLL_INTERVAL_MS || 5000));
  const timeoutMs = Math.max(intervalMs, Number(options.pollTimeoutMs || process.env.AI_GATEWAY_JIMENG_POLL_TIMEOUT_MS || 900_000));
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await delay(intervalMs);
    const result = await pollImpl(taskId, registryId, {
      userId: plan.job.userId || null,
      ...(options.credentials ? { credentials: options.credentials } : {}),
    });
    if (!result?.ok) {
      const failed = await store.update(plan.job.id, {
        status: 'failed',
        error: {
          code: result?.body?.code || 'JIMENG_POLL_FAILED',
          message: publicJimengError(result, 'Jimeng video poll failed'),
        },
        metadata: {
          jimengTaskId: taskId,
          upstreamTaskId: taskId,
          jimengRegistryId: registryId,
          gatewayExecution: { failedAt: new Date().toISOString() },
        },
      });
      await finalizeAiGatewayTerminalPlan(failed, store);
      return;
    }
    const body = result.body && typeof result.body === 'object' ? result.body : {};
    const status = String(body.status || '').trim().toLowerCase();
    if (status === 'done') {
      const videoUrl = nonEmptyString(body.videoUrl) || nonEmptyString(body.video_url);
      if (!videoUrl) {
        const failed = await store.update(plan.job.id, {
          status: 'failed',
          error: { code: 'JIMENG_VIDEO_URL_MISSING', message: 'Jimeng video task completed without videoUrl' },
          metadata: {
            jimengTaskId: taskId,
            upstreamTaskId: taskId,
            jimengRegistryId: registryId,
            gatewayExecution: { failedAt: new Date().toISOString() },
          },
        });
        await finalizeAiGatewayTerminalPlan(failed, store);
        return;
      }
      const succeeded = await store.update(plan.job.id, {
        status: 'succeeded',
        output: {
          provider: 'volcengine-jimeng',
          taskId,
          registryId,
          videoUrl,
          raw: body.raw || body,
        },
        artifacts: [
          {
            kind: 'video',
            url: videoUrl,
            source: 'volcengine-jimeng',
            taskId,
            registryId,
          },
        ],
        metadata: {
          jimengTaskId: taskId,
          upstreamTaskId: taskId,
          jimengRegistryId: registryId,
          gatewayExecution: { completedAt: new Date().toISOString() },
        },
      });
      await finalizeAiGatewayTerminalPlan(succeeded, store);
      return;
    }
    if (status === 'failed' || status === 'error') {
      const failed = await store.update(plan.job.id, {
        status: 'failed',
        error: { code: body.code || 'JIMENG_TASK_FAILED', message: nonEmptyString(body.message) || 'Jimeng video task failed' },
        metadata: {
          jimengTaskId: taskId,
          upstreamTaskId: taskId,
          jimengRegistryId: registryId,
          gatewayExecution: { failedAt: new Date().toISOString() },
        },
      });
      await finalizeAiGatewayTerminalPlan(failed, store);
      return;
    }
    await store.update(plan.job.id, {
      status: status === 'pending' ? 'queued' : 'running',
      metadata: {
        jimengTaskId: taskId,
        upstreamTaskId: taskId,
        jimengRegistryId: registryId,
        jimengStatus: status || 'pending',
        ...(body.progress != null ? { jimengProgress: Number(body.progress) } : {}),
      },
    });
  }

  const failed = await store.update(plan.job.id, {
    status: 'failed',
    error: { code: 'JIMENG_POLL_TIMEOUT', message: 'Jimeng video task polling timed out' },
    metadata: {
      jimengTaskId: taskId,
      upstreamTaskId: taskId,
      jimengRegistryId: registryId,
      gatewayExecution: { failedAt: new Date().toISOString() },
    },
  });
  await finalizeAiGatewayTerminalPlan(failed, store);
}

export async function startJimengVideoExecution(plan, options = {}) {
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
  const registryId = nonEmptyString(requestBody.registryId) || JIMENG_VISUAL_DEFAULT_VIDEO_REGISTRY_ID;
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
    const pollPromise = pollJimengVideoTask(next || plan, taskId, registryId, {
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
