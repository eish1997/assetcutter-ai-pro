import crypto from 'crypto';
import { fetch as undiciFetch } from 'undici';
import { acquireProviderKey, recordProviderKeyError, recordProviderKeySuccess } from '../provider-key-store.js';
import { AiGatewayValidationError } from '../job.js';
import { finalizeAiGatewayTerminalPlan } from '../execution-finalize.js';
import { applyAiGatewayAdapterResult } from '../adapter-result.js';
import { buildProviderTaskUsage, collectByteSize } from '../execution-usage.js';
import { normalizeGatewayInput } from '../gateway-input.js';

export const TENCENT_HUNYUAN_PROVIDER_ID = 'tencent-hunyuan';
const AI3D_HOST = 'ai3d.tencentcloudapi.com';
const AI3D_SERVICE = 'ai3d';
const AI3D_VERSION = '2025-05-13';
const AI3D_REGION = 'ap-guangzhou';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function buildTencentAuthHeader({ secretId, secretKey, payload, timestamp, date }) {
  const contentType = 'application/json; charset=utf-8';
  const canonicalHeaders = `content-type:${contentType}\nhost:${AI3D_HOST}\n`;
  const signedHeaders = 'content-type;host';
  const hashedPayload = sha256Hex(JSON.stringify(payload));
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
  const credentialScope = `${date}/${AI3D_SERVICE}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const kDate = hmac(`TC3${secretKey}`, date);
  const kService = hmac(kDate, AI3D_SERVICE);
  const kSigning = hmac(kService, 'tc3_request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function readJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text || '{}');
  } catch {
    return { message: text };
  }
}

async function callTencentAi3d(action, payload, key, options = {}) {
  const secretId = nonEmptyString(key.credentials?.secretId);
  const secretKey = nonEmptyString(key.credentials?.secretKey);
  if (!secretId || !secretKey) {
    throw new AiGatewayValidationError('Tencent Hunyuan 3D requires SecretId and SecretKey', 'AI_GATEWAY_PROVIDER_KEY_MISSING');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const fetchImpl = options.fetchImpl || undiciFetch;
  const response = await fetchImpl(`https://${AI3D_HOST}/`, {
    method: 'POST',
    headers: {
      Authorization: buildTencentAuthHeader({ secretId, secretKey, payload, timestamp, date }),
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': AI3D_VERSION,
      'X-TC-Region': nonEmptyString(key.credentials?.region) || AI3D_REGION,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number(options.timeoutMs || process.env.AI_GATEWAY_TENCENT_3D_REQUEST_TIMEOUT_MS || 45_000)),
  });
  const data = await readJsonSafe(response);
  const body = data?.Response || data;
  if (!response.ok || body?.Error) {
    const code = body?.Error?.Code || data?.code || `HTTP_${response.status}`;
    const message = body?.Error?.Message || data?.message || data?.error || 'Tencent Hunyuan 3D request failed';
    const err = new Error(`Tencent Hunyuan 3D ${action} failed: ${code} ${message}`);
    err.status = response.status;
    throw err;
  }
  return body;
}

function stripDataUrl(value) {
  return nonEmptyString(value).replace(/^data:image\/\w+;base64,/i, '');
}

function buildTencentSubmitPayload(job) {
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const gatewayInput = normalizeGatewayInput(job);
  const registryId = nonEmptyString(input.registryId) || nonEmptyString(input.canonicalModelId) || nonEmptyString(job?.model);
  const rapid = registryId.includes('rapid');
  const prompt = gatewayInput.prompt;
  const image = gatewayInput.referenceImages[0] || '';
  const payload = {};
  if (image) {
    if (/^data:image\//i.test(image)) payload.ImageBase64 = stripDataUrl(image);
    else payload.ImageUrl = image;
  } else if (prompt) {
    payload.Prompt = prompt;
  } else {
    throw new AiGatewayValidationError('Tencent Hunyuan 3D requires prompt or reference image', 'AI_GATEWAY_TENCENT_3D_INPUT_REQUIRED');
  }
  if (!rapid) payload.Model = nonEmptyString(input.model) || '3.0';
  if (gatewayInput.format) payload.ResultFormat = String(gatewayInput.format).toUpperCase();
  if (typeof gatewayInput.texture === 'boolean') payload.EnablePBR = gatewayInput.texture;
  if (typeof input.enablePBR === 'boolean') payload.EnablePBR = input.enablePBR;
  if (input.faceCount) payload.FaceCount = Number(input.faceCount);
  if (input.generateType) payload.GenerateType = input.generateType;
  if (input.polygonType) payload.PolygonType = input.polygonType;
  return {
    rapid,
    action: rapid ? 'SubmitHunyuanTo3DRapidJob' : 'SubmitHunyuanTo3DProJob',
    queryAction: rapid ? 'QueryHunyuanTo3DRapidJob' : 'QueryHunyuanTo3DProJob',
    payload,
  };
}

export function buildTencentHunyuan3dWorkerRequest(job, route) {
  if (route?.adapterId !== 'tencent-hunyuan-3d') {
    throw new AiGatewayValidationError(`Unsupported adapter for Tencent Hunyuan 3D: ${route?.adapterId || ''}`);
  }
  const submit = buildTencentSubmitPayload(job);
  return {
    method: 'POST',
    path: '/',
    providerBaseUrl: `https://${AI3D_HOST}`,
    body: submit.payload,
    metadata: {
      submitAction: submit.action,
      queryAction: submit.queryAction,
      rapid: submit.rapid,
    },
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-ac-task-envelope': job.id,
      'x-ac-correlation-id': job.correlationId,
    },
  };
}

function normalizeTencentStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (status === 'DONE' || status === 'SUCCESS' || status === 'SUCCEED') return 'succeeded';
  if (status === 'FAIL' || status === 'FAILED' || status === 'ERROR') return 'failed';
  if (status === 'WAIT' || status === 'PENDING' || status === 'QUEUED') return 'queued';
  return 'running';
}

function normalizeTencentFiles(files) {
  const rows = Array.isArray(files) ? files : [];
  const modelUrls = [];
  let previewUrl = '';
  for (const file of rows) {
    const url = nonEmptyString(file?.Url || file?.url);
    const preview = nonEmptyString(file?.PreviewImageUrl || file?.previewImageUrl);
    if (preview && !previewUrl) previewUrl = preview;
    if (url && !modelUrls.includes(url)) modelUrls.push(url);
  }
  if (!previewUrl) previewUrl = modelUrls.find((url) => /\.(png|jpe?g|webp)(\?|#|$)/i.test(url)) || '';
  return { modelUrls, previewUrl };
}

async function pollTencentHunyuan3dTask(plan, jobId, key, options = {}) {
  const store = options.store;
  if (!store?.update || !plan?.job?.id || !jobId) return;
  const queryAction = plan.workerRequest?.metadata?.queryAction || 'QueryHunyuanTo3DProJob';
  const intervalMs = Math.max(1000, Number(options.pollIntervalMs || process.env.AI_GATEWAY_TENCENT_3D_POLL_INTERVAL_MS || 5000));
  const timeoutMs = Math.max(intervalMs, Number(options.pollTimeoutMs || process.env.AI_GATEWAY_TENCENT_3D_POLL_TIMEOUT_MS || 900_000));
  const startedAt = Date.now();
  const startedAtMs = Date.parse(plan.job?.startedAt || '') || startedAt;

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const data = await callTencentAi3d(queryAction, { JobId: jobId }, key, options);
    const status = normalizeTencentStatus(data?.Status);
    if (status === 'succeeded') {
      const completedAtMs = Date.now();
      const { modelUrls, previewUrl } = normalizeTencentFiles(data?.ResultFile3Ds);
      if (!modelUrls.length) {
        const { plan: failed } = await applyAiGatewayAdapterResult(
          plan,
          {
            status: 'failed',
            upstreamTaskId: jobId,
            error: { code: 'TENCENT_HUNYUAN_3D_MODEL_URL_MISSING', message: 'Tencent Hunyuan 3D task completed without model URL' },
          },
          store,
          {
            metadata: {
              tencentJobId: jobId,
              gatewayExecution: { failedAt: new Date().toISOString() },
            },
          }
        );
        await finalizeAiGatewayTerminalPlan(failed, store);
        return;
      }
      const outputBytes = collectByteSize(data);
      const usage = buildProviderTaskUsage(plan, {
        provider: TENCENT_HUNYUAN_PROVIDER_ID,
        upstreamTaskId: jobId,
        billingSku: plan.workerRequest?.metadata?.rapid ? '3d.tencent.rapid' : '3d.tencent.pro',
        meterKind: 'task',
        unit: 'task',
        quantity: 1,
        outputBytes,
        artifactCount: modelUrls.length,
        startedAtMs,
        completedAtMs,
      });
      const artifacts = [
        ...modelUrls.map((url) => ({
          kind: 'model3d',
          url,
          source: TENCENT_HUNYUAN_PROVIDER_ID,
          taskId: jobId,
          registryId: plan.job?.model || null,
          billing: { actualCredits: usage.actualCredits, settlementSource: usage.settlementSource },
        })),
        ...(previewUrl ? [{ kind: 'image', url: previewUrl, source: TENCENT_HUNYUAN_PROVIDER_ID, taskId: jobId }] : []),
      ];
      const { plan: succeeded } = await applyAiGatewayAdapterResult(
        plan,
        {
          status: 'succeeded',
          upstreamTaskId: jobId,
          artifacts,
          usage,
          output: {
            provider: TENCENT_HUNYUAN_PROVIDER_ID,
            taskId: jobId,
            modelUrls,
            ...(previewUrl ? { previewUrl } : {}),
            raw: data,
          },
        },
        store,
        {
          metadata: {
            tencentJobId: jobId,
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
      return;
    }
    if (status === 'failed') {
      const { plan: failed } = await applyAiGatewayAdapterResult(
        plan,
        {
          status: 'failed',
          upstreamTaskId: jobId,
          error: { code: data?.ErrorCode || 'TENCENT_HUNYUAN_3D_TASK_FAILED', message: data?.ErrorMessage || 'Tencent Hunyuan 3D task failed' },
        },
        store,
        {
          metadata: {
            tencentJobId: jobId,
            gatewayExecution: { failedAt: new Date().toISOString() },
          },
        }
      );
      await finalizeAiGatewayTerminalPlan(failed, store);
      return;
    }
    await store.update(plan.job.id, {
      status: status === 'queued' ? 'queued' : 'running',
      metadata: { tencentJobId: jobId, upstreamTaskId: jobId, tencentStatus: status },
    });
  }
}

export async function startTencentHunyuan3dExecution(plan, options = {}) {
  const key = options.providerKey || (await acquireProviderKey(TENCENT_HUNYUAN_PROVIDER_ID));
  if (!key?.credentials?.secretId || !key?.credentials?.secretKey) {
    throw new AiGatewayValidationError('No enabled Tencent Hunyuan SecretId/SecretKey in provider key pool', 'AI_GATEWAY_PROVIDER_KEY_MISSING');
  }
  const request = plan.workerRequest || plan.adapterRequest;
  const action = request?.metadata?.submitAction || 'SubmitHunyuanTo3DProJob';
  try {
    const data = await callTencentAi3d(action, request.body || {}, key, options);
    recordProviderKeySuccess(key.id);
    const jobId = nonEmptyString(data?.JobId);
    if (!jobId) throw new Error('Tencent Hunyuan 3D did not return JobId');
    const metadata = {
      gatewayExecution: {
        startedAt: new Date().toISOString(),
        targetPath: request.path || '/',
        providerKeyId: key.id,
      },
      tencentJobId: jobId,
      upstreamTaskId: jobId,
    };
    const updated = options.store?.update
      ? await options.store.update(plan.job.id, { status: 'queued', metadata })
      : plan;
    const next = updated?.job?.id ? updated : updated?.id ? { ...plan, job: updated } : plan;
    if (!options.disableBackgroundPoll) {
      const pollPromise = pollTencentHunyuan3dTask(next, jobId, key, options);
      if (options.awaitBackgroundPoll) await pollPromise;
      else void pollPromise;
    }
    return { started: true, upstreamJobId: jobId, tencentJobId: jobId, plan: next };
  } catch (error) {
    if (key?.id) {
      recordProviderKeyError(key.id, error, {
        status: error?.status,
        cooldownMs: error?.status === 429 || error?.status >= 500 ? 60_000 : 0,
        reason: 'Tencent Hunyuan 3D handoff failed',
      });
    }
    throw error;
  }
}

export async function cancelTencentHunyuan3dExecution(plan) {
  const { softAiGatewayCancelResult } = await import('../cancel-result.js');
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  const upstreamTaskId = nonEmptyString(metadata.upstreamTaskId) || nonEmptyString(metadata.tencentJobId);
  return softAiGatewayCancelResult({
    reason: 'tencent_hunyuan_3d_hard_cancel_unavailable',
    cancelReason: 'tencent_hunyuan_3d_hard_cancel_unavailable',
    upstreamTaskId: upstreamTaskId || null,
    provider: TENCENT_HUNYUAN_PROVIDER_ID,
    adapterId: 'tencent-hunyuan-3d',
  });
}
