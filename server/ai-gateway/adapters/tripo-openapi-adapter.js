import { fetch as undiciFetch } from 'undici';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { acquireProviderKey, recordProviderKeyError, recordProviderKeySuccess } from '../provider-key-store.js';
import { AiGatewayValidationError } from '../job.js';
import { finalizeAiGatewayTerminalPlan } from '../execution-finalize.js';
import { buildProviderTaskUsage, collectByteSize } from '../execution-usage.js';

export const TRIPO_OPENAPI_BASE_URL = 'https://api.tripo3d.ai/v2/openapi';

const TRIPO_MODEL_VERSION_MAP = Object.freeze({
  'tripo-p1': 'P1-20260311',
  'tripo-v3.1': 'v3.1-20260211',
  'tripo-v3.0': 'v3.0-20250812',
  'tripo-v2.5': 'v2.5-20250123',
  'tripo-v2.0': 'v2.0-20240919',
});

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeTaskStatus(value) {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'queued' || s === 'pending' || s === 'created' || s === 'submitted') return 'queued';
  if (s === 'running' || s === 'processing' || s === 'in_progress') return 'running';
  if (s === 'success' || s === 'succeeded' || s === 'finished' || s === 'done') return 'succeeded';
  if (s === 'failed' || s === 'error' || s === 'cancelled' || s === 'expired') return 'failed';
  return 'running';
}

function extractTaskId(data) {
  return (
    nonEmptyString(data?.task_id) ||
    nonEmptyString(data?.id) ||
    nonEmptyString(data?.data?.task_id) ||
    nonEmptyString(data?.data?.id)
  );
}

function classifyTripoUrl(value, keyPath = '') {
  const url = nonEmptyString(value);
  if (!/^https?:\/\//i.test(url)) return null;
  const key = String(keyPath || '').toLowerCase();
  const modelLikeKey = /(model|mesh|glb|gltf|fbx|obj|stl|usdz|3mf|download|file_3d|file3d)/i.test(key);
  const imageLikeKey = /(preview|thumbnail|render|rendered|image|poster|cover)/i.test(key);
  const modelLikeUrl = /\.(glb|gltf|fbx|obj|stl|usdz|3mf|zip)(\?|#|$)/i.test(url);
  const imageLikeUrl = /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(url);
  if (modelLikeUrl || (modelLikeKey && !imageLikeUrl)) return 'model';
  if (imageLikeUrl || imageLikeKey) return 'preview';
  return null;
}

export function extractTripoTaskArtifacts(task) {
  const modelUrls = [];
  let previewUrl = '';
  const push = (value, keyPath = '') => {
    const url = nonEmptyString(value);
    const kind = classifyTripoUrl(url, keyPath);
    if (kind === 'model' && !modelUrls.includes(url)) modelUrls.push(url);
    if (kind === 'preview' && !previewUrl) previewUrl = url;
  };
  const walk = (obj, path = '') => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(obj)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (typeof value === 'string') push(value, nextPath);
      else walk(value, nextPath);
    }
  };
  walk(task);
  return { modelUrls, previewUrl };
}

function normalizeModelUrls(task) {
  return extractTripoTaskArtifacts(task).modelUrls;
}

function tripoErrorMessage(data, fallback = 'Tripo request failed') {
  if (!data || typeof data !== 'object') return fallback;
  return (
    nonEmptyString(data.message) ||
    nonEmptyString(data.msg) ||
    nonEmptyString(data.detail) ||
    nonEmptyString(data.error?.message) ||
    nonEmptyString(data.error?.msg) ||
    fallback
  );
}

function parseDataUrlImage(dataUrl) {
  const raw = nonEmptyString(dataUrl);
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(raw);
  if (!m) return null;
  const mime = m[1] || 'image/png';
  const bytes = Buffer.from(m[2] || '', 'base64');
  if (!bytes.byteLength) return null;
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
  const format = ext === 'jpg' ? 'jpeg' : ext;
  return { mime, bytes, ext, format, filename: `input.${ext}` };
}

function imageDimensions(bytes, mime) {
  const type = String(mime || '').toLowerCase();
  if (type.includes('png') && bytes.byteLength >= 24) {
    const sig = [0x89, 0x50, 0x4e, 0x47];
    if (sig.every((value, index) => bytes[index] === value)) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
  }
  if ((type.includes('jpeg') || type.includes('jpg')) && bytes.byteLength >= 4) {
    let offset = 2;
    while (offset + 9 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < bytes.byteLength) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + Math.max(2, length);
    }
  }
  return null;
}

async function requestTripoUploadSts(apiKey, parsed, options = {}) {
  const fetchImpl = options.fetchImpl || undiciFetch;
  const timeoutMs = Number(options.uploadTimeoutMs || process.env.AI_GATEWAY_TRIPO_UPLOAD_TIMEOUT_MS || 60_000);
  const formats = [parsed.format, parsed.ext].filter((value, index, arr) => value && arr.indexOf(value) === index);
  const attempts = [];
  for (const format of formats) {
    attempts.push({
      label: `json:${format}`,
      url: `${TRIPO_OPENAPI_BASE_URL}/upload/sts`,
      init: {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    });
    attempts.push({
      label: `form:${format}`,
      url: `${TRIPO_OPENAPI_BASE_URL}/upload/sts`,
      init: {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ format }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      },
    });
    attempts.push({
      label: `query:${format}`,
      url: `${TRIPO_OPENAPI_BASE_URL}/upload/sts?format=${encodeURIComponent(format)}`,
      init: {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      },
    });
  }
  let last = null;
  for (const attempt of attempts) {
    const response = await fetchImpl(attempt.url, attempt.init);
    const data = await readJsonSafe(response);
    if (response.ok) return { data, attempt: attempt.label };
    last = { status: response.status, data, attempt: attempt.label };
    if (![400, 404, 415, 422].includes(Number(response.status))) break;
  }
  throw new Error(
    `Tripo upload STS rejected: HTTP ${last?.status || 0} ${tripoErrorMessage(last?.data)} (${last?.attempt || 'no-attempt'})`
  );
}

async function requestTripoDirectUpload(apiKey, parsed, options = {}) {
  const fetchImpl = options.fetchImpl || undiciFetch;
  const timeoutMs = Number(options.uploadTimeoutMs || process.env.AI_GATEWAY_TRIPO_UPLOAD_TIMEOUT_MS || 60_000);
  const form = new FormData();
  form.append('file', new Blob([parsed.bytes], { type: parsed.mime }), parsed.filename);
  const response = await fetchImpl(`${TRIPO_OPENAPI_BASE_URL}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await readJsonSafe(response);
  if (!response.ok) {
    throw new Error(`Tripo direct upload rejected: HTTP ${response.status} ${tripoErrorMessage(data)}`);
  }
  const token =
    nonEmptyString(data?.data?.image_token) ||
    nonEmptyString(data?.image_token) ||
    nonEmptyString(data?.data?.file_token) ||
    nonEmptyString(data?.file_token);
  if (!token) {
    throw new Error(`Tripo direct upload response missing image_token: ${tripoErrorMessage(data)}`);
  }
  return { type: parsed.ext, file_token: token };
}

async function uploadImageToTripo(apiKey, imageBase64DataUrl, options = {}) {
  const parsed = parseDataUrlImage(imageBase64DataUrl);
  if (!parsed) {
    throw new AiGatewayValidationError('Tripo image task requires a valid imageBase64DataUrl', 'AI_GATEWAY_TRIPO_IMAGE_REQUIRED');
  }
  const dims = imageDimensions(parsed.bytes, parsed.mime);
  if (dims && Math.max(dims.width, dims.height) < 257) {
    throw new AiGatewayValidationError('Tripo image task requires a reference image larger than 256px; please use the full asset instead of a tiny thumbnail', 'AI_GATEWAY_TRIPO_IMAGE_TOO_SMALL');
  }
  try {
    return await requestTripoDirectUpload(apiKey, parsed, options);
  } catch (error) {
    if (!/HTTP (400|404|415|422)\b/i.test(error instanceof Error ? error.message : String(error))) {
      throw error;
    }
  }
  const { data } = await requestTripoUploadSts(apiKey, parsed, options);
  const sts = data?.data && typeof data.data === 'object' ? data.data : data;
  const bucket = nonEmptyString(sts?.resource_bucket);
  const key = nonEmptyString(sts?.resource_uri);
  const sessionToken = nonEmptyString(sts?.session_token);
  const accessKeyId = nonEmptyString(sts?.sts_ak);
  const secretAccessKey = nonEmptyString(sts?.sts_sk);
  if (!bucket || !key || !sessionToken || !accessKeyId || !secretAccessKey) {
    throw new Error(`Tripo upload STS response missing S3 credentials: ${tripoErrorMessage(data)}`);
  }
  const s3Host = nonEmptyString(sts?.s3_host) || 's3.us-west-2.amazonaws.com';
  const s3Client = options.s3Client || new S3Client({
    region: 'us-west-2',
    endpoint: /^https?:\/\//i.test(s3Host) ? s3Host : `https://${s3Host}`,
    credentials: { accessKeyId, secretAccessKey, sessionToken },
    forcePathStyle: true,
  });
  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: parsed.bytes,
    ContentType: parsed.mime,
  }));
  const token = key;
  return { type: parsed.ext, file_token: token };
}

function buildTripoTaskBody(job) {
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const prompt = nonEmptyString(input.prompt) || nonEmptyString(input.text) || nonEmptyString(input.contents?.[0]?.parts?.[0]?.text);
  const firstReferenceImage = Array.isArray(input.referenceImages)
    ? input.referenceImages.map((value) => nonEmptyString(value)).find(Boolean)
    : '';
  const type = nonEmptyString(input.type) || (firstReferenceImage ? 'image_to_model' : 'text_to_model');
  if (type === 'text_to_model' && !prompt) {
    throw new AiGatewayValidationError('Tripo text_to_model requires input.prompt', 'AI_GATEWAY_TRIPO_PROMPT_REQUIRED');
  }
  const body = {
    type,
    ...(prompt ? { prompt } : {}),
  };
  const registryId = nonEmptyString(input.registryId) || nonEmptyString(input.canonicalModelId) || nonEmptyString(job?.model);
  const mappedModelVersion = TRIPO_MODEL_VERSION_MAP[registryId];
  if (mappedModelVersion && !nonEmptyString(input.modelVersion)) body.model_version = mappedModelVersion;
  const map = [
    ['negativePrompt', 'negative_prompt'],
    ['modelVersion', 'model_version'],
    ['textureQuality', 'texture_quality'],
    ['geometryQuality', 'geometry_quality'],
    ['faceLimit', 'face_limit'],
    ['smartLowPoly', 'smart_low_poly'],
    ['generateParts', 'generate_parts'],
    ['autoSize', 'auto_size'],
    ['exportUv', 'export_uv'],
    ['enableImageAutofix', 'enable_image_autofix'],
    ['textureAlignment', 'texture_alignment'],
    ['orientation', 'orientation'],
  ];
  for (const [from, to] of map) {
    if (input[from] !== undefined && input[from] !== null && input[from] !== '') body[to] = input[from];
  }
  for (const key of ['texture', 'pbr', 'quad', 'compress']) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== '') body[key] = input[key];
  }
  if (type === 'image_to_model') {
    if (nonEmptyString(input.imageUrl)) body.file = { type: 'url', url: nonEmptyString(input.imageUrl) };
    else if (nonEmptyString(input.imageBase64DataUrl)) body.imageBase64DataUrl = input.imageBase64DataUrl;
    else if (firstReferenceImage && /^https?:\/\//i.test(firstReferenceImage)) body.file = { type: 'url', url: firstReferenceImage };
    else if (firstReferenceImage) body.imageBase64DataUrl = firstReferenceImage;
    else throw new AiGatewayValidationError('Tripo image_to_model requires image input', 'AI_GATEWAY_TRIPO_IMAGE_REQUIRED');
  }
  if (type === 'multiview_to_model') {
    const slots = input.multiviewImageBase64DataUrls && typeof input.multiviewImageBase64DataUrls === 'object'
      ? input.multiviewImageBase64DataUrls
      : {};
    if (!nonEmptyString(slots.front)) {
      throw new AiGatewayValidationError('Tripo multiview_to_model requires front image', 'AI_GATEWAY_TRIPO_MULTIVIEW_FRONT_REQUIRED');
    }
    const count = ['front', 'left', 'back', 'right'].filter((slot) => nonEmptyString(slots[slot])).length;
    if (count < 2) {
      throw new AiGatewayValidationError('Tripo multiview_to_model requires at least two images', 'AI_GATEWAY_TRIPO_MULTIVIEW_MIN_REQUIRED');
    }
    body.multiviewImageBase64DataUrls = slots;
  }
  return body;
}

async function prepareTripoTaskBodyForUpstream(apiKey, body, options = {}) {
  if (body.type === 'image_to_model' && body.imageBase64DataUrl) {
    const { imageBase64DataUrl, ...rest } = body;
    return { ...rest, file: await uploadImageToTripo(apiKey, imageBase64DataUrl, options) };
  }
  if (body.type === 'multiview_to_model') {
    const slots = body.multiviewImageBase64DataUrls || {};
    const files = [];
    for (const slot of ['front', 'left', 'back', 'right']) {
      files.push(nonEmptyString(slots[slot]) ? await uploadImageToTripo(apiKey, slots[slot], options) : { type: 'jpg' });
    }
    const { multiviewImageBase64DataUrls, ...rest } = body;
    return { ...rest, files };
  }
  return body;
}

export function buildTripoWorkerRequest(job, route) {
  if (route?.adapterId !== 'tripo-openapi') {
    throw new AiGatewayValidationError(`Unsupported adapter for Tripo: ${route?.adapterId || ''}`);
  }
  return {
    method: 'POST',
    path: '/task',
    providerBaseUrl: TRIPO_OPENAPI_BASE_URL,
    body: buildTripoTaskBody(job),
    headers: {
      'content-type': 'application/json',
      'x-ac-task-envelope': job.id,
      'x-ac-correlation-id': job.correlationId,
    },
  };
}

async function readJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text || '{}');
  } catch {
    return { message: text };
  }
}

async function pollDelay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

async function pollTripoTask(plan, taskId, apiKey, options = {}) {
  const store = options.store;
  if (!store?.update || !plan?.job?.id || !taskId) return;
  const fetchImpl = options.fetchImpl || undiciFetch;
  const intervalFloorMs = options.pollIntervalMs != null ? 1 : 3000;
  const intervalMs = Math.max(intervalFloorMs, Number(options.pollIntervalMs || process.env.AI_GATEWAY_TRIPO_POLL_INTERVAL_MS || 5000));
  const timeoutMs = Math.max(intervalMs, Number(options.pollTimeoutMs || process.env.AI_GATEWAY_TRIPO_POLL_TIMEOUT_MS || 900_000));
  const startedAt = Date.now();
  const startedAtMs = Date.parse(plan.job?.startedAt || '') || startedAt;

  while (Date.now() - startedAt < timeoutMs) {
    await pollDelay(intervalMs);
    try {
      const response = await fetchImpl(`${TRIPO_OPENAPI_BASE_URL}/task/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(Number(options.pollRequestTimeoutMs || 30_000)),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) continue;
      const status = normalizeTaskStatus(data?.status ?? data?.data?.status ?? data?.task?.status);
      if (status === 'succeeded') {
        const { modelUrls, previewUrl } = extractTripoTaskArtifacts(data);
        const completedAtMs = Date.now();
        const outputBytes = collectByteSize(data);
        const usage = buildProviderTaskUsage(plan, {
          provider: 'tripo',
          upstreamTaskId: taskId,
          billingSku: '3d.tripo.task',
          meterKind: 'task',
          unit: 'task',
          quantity: 1,
          outputBytes,
          artifactCount: modelUrls.length,
          startedAtMs,
          completedAtMs,
        });
        const succeeded = await store.update(plan.job.id, {
          status: 'succeeded',
          output: {
            provider: 'tripo',
            taskId,
            modelUrls,
            previewUrl: previewUrl || undefined,
            usage,
            raw: data,
          },
          artifacts: [
            ...modelUrls.map((url) => ({
              kind: 'model3d',
              url,
              source: 'tripo',
              taskId,
              billing: {
                actualCredits: usage.actualCredits,
                settlementSource: usage.settlementSource,
              },
            })),
            ...(previewUrl
              ? [{
                  kind: 'image',
                  url: previewUrl,
                  source: 'tripo',
                  taskId,
                  role: 'preview',
                }]
              : []),
          ],
          metadata: {
            tripoTaskId: taskId,
            upstreamTaskId: taskId,
            usage,
            gatewayExecution: {
              completedAt: new Date(completedAtMs).toISOString(),
              durationMs: usage.durationMs,
              outputBytes,
              artifactCount: modelUrls.length,
            },
          },
        });
        await finalizeAiGatewayTerminalPlan(succeeded, store);
        return;
      }
      if (status === 'failed') {
        const failed = await store.update(plan.job.id, {
          status: 'failed',
          error: { code: 'TRIPO_TASK_FAILED', message: tripoErrorMessage(data, 'Tripo task failed') },
          metadata: {
            tripoTaskId: taskId,
            upstreamTaskId: taskId,
            gatewayExecution: { failedAt: new Date().toISOString() },
          },
        });
        await finalizeAiGatewayTerminalPlan(failed, store);
        return;
      }
      await store.update(plan.job.id, {
        status: status === 'queued' ? 'queued' : 'running',
        metadata: { tripoTaskId: taskId, upstreamTaskId: taskId, tripoStatus: status },
      });
    } catch {
      // Polling is best-effort; leave the last known state for admin retry/inspection.
    }
  }
}

export async function cancelTripoExecution(plan) {
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  const upstreamTaskId = nonEmptyString(metadata.upstreamTaskId) || nonEmptyString(metadata.tripoTaskId);
  return {
    cancelled: false,
    mode: 'soft',
    reason: 'tripo_hard_cancel_unavailable',
    upstreamTaskId: upstreamTaskId || null,
    provider: 'tripo',
  };
}

export async function startTripoExecution(plan, options = {}) {
  const key = await acquireProviderKey('tripo');
  if (!key?.secret) {
    throw new AiGatewayValidationError('No enabled Tripo API key in AI Gateway provider key pool', 'AI_GATEWAY_PROVIDER_KEY_MISSING');
  }
  const fetchImpl = options.fetchImpl || undiciFetch;
  let upstreamBody;
  try {
    upstreamBody = await prepareTripoTaskBodyForUpstream(
      key.secret,
      plan.workerRequest?.body || plan.adapterRequest?.body || {},
      options
    );
  } catch (error) {
    recordProviderKeyError(key.id, error, { cooldownMs: 0 });
    throw error;
  }
  const response = await fetchImpl(`${TRIPO_OPENAPI_BASE_URL}${plan.workerRequest?.path || plan.adapterRequest?.path || '/task'}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.secret}`,
    },
    body: JSON.stringify(upstreamBody),
    signal: AbortSignal.timeout(Number(options.timeoutMs || process.env.AI_GATEWAY_TRIPO_START_TIMEOUT_MS || 45_000)),
  });
  const data = await readJsonSafe(response);
  if (!response.ok) {
    const err = new Error(`Tripo rejected AI job handoff: HTTP ${response.status} ${tripoErrorMessage(data)}`);
    recordProviderKeyError(key.id, err, {
      status: response.status,
      cooldownMs: response.status === 429 || response.status >= 500 ? 60_000 : 0,
      reason: `Tripo HTTP ${response.status}`,
    });
    throw err;
  }
  recordProviderKeySuccess(key.id);
  const taskId = extractTaskId(data);
  if (!taskId) throw new Error('Tripo did not return task_id');

  const metadata = {
    gatewayExecution: {
      startedAt: new Date().toISOString(),
      targetPath: plan.workerRequest?.path || plan.adapterRequest?.path || '/task',
      providerKeyId: key.id,
    },
    tripoTaskId: taskId,
    upstreamTaskId: taskId,
  };
  const next = options.store?.update
    ? await options.store.update(plan.job.id, { status: 'queued', metadata })
    : plan;
  if (!options.disableBackgroundPoll) {
    const pollPromise = pollTripoTask(next || plan, taskId, key.secret, options);
    if (options.awaitBackgroundPoll) await pollPromise;
    else void pollPromise;
  }
  return { started: true, upstreamJobId: taskId, tripoTaskId: taskId, plan: next || plan };
}
