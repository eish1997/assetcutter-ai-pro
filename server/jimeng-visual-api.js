/**
 * 即梦 Visual API 代理：Submit (CVSync2AsyncSubmitTask) / Poll (CVSync2AsyncGetResult)。
 * AK/SK 仅服务端；由 auth-api 内联挂载 /api/jimeng/*。
 */
import { signVolcengineRequest } from './jimeng-sign.js';
import { resolveVerifiedJimengReqKey } from '../shared/jimengVerifiedRegistry.js';

const DEFAULT_HOST = 'visual.volcengineapi.com';
const DEFAULT_REGION = 'cn-north-1';
const DEFAULT_SERVICE = 'cv';
const DEFAULT_VERSION = '2022-08-31';
const UPSTREAM_TIMEOUT_MS = Number(process.env.JIMENG_UPSTREAM_TIMEOUT_MS || 60_000);
const MAX_CONCURRENT_POLLS_PER_USER = Number(process.env.JIMENG_MAX_CONCURRENT_POLLS_PER_USER || 3);

/** @type {Map<string, number>} userId → active poll count */
const pollCountByUser = new Map();

function envTrim(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function envBool(name, defaultFalse = false) {
  const raw = envTrim(name, defaultFalse ? 'false' : '');
  if (!raw) return defaultFalse;
  const v = raw.toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

export function jimengVisualHost() {
  return envTrim('JIMENG_VISUAL_HOST', DEFAULT_HOST);
}

export function jimengVisualRegion() {
  return envTrim('JIMENG_VISUAL_REGION', DEFAULT_REGION);
}

export function jimengVisualService() {
  return envTrim('JIMENG_VISUAL_SERVICE', DEFAULT_SERVICE);
}

export function jimengVisualVersion() {
  return envTrim('JIMENG_VISUAL_VERSION', DEFAULT_VERSION);
}

export function isJimengApiEnabledFlag() {
  return envBool('JIMENG_API_ENABLED', false);
}

export function isJimengConfigured() {
  return Boolean(envTrim('VOLCENGINE_ACCESS_KEY') && envTrim('VOLCENGINE_SECRET_KEY'));
}

/** 服务可用：开关 + AK/SK */
export function isJimengServiceAvailable() {
  return isJimengApiEnabledFlag() && isJimengConfigured();
}

export function getJimengStatusResponse() {
  return {
    enabled: isJimengServiceAvailable(),
    configured: isJimengConfigured(),
  };
}

export function jimengNotConfiguredBody() {
  return {
    error: '即梦 API 未配置或未启用',
    code: 'JIMENG_NOT_CONFIGURED',
  };
}

/**
 * @param {string} registryId
 * @returns {{ reqKey: string, modality: 'image' | 'video' } | null}
 */
export function resolveJimengReqKey(registryId) {
  return resolveVerifiedJimengReqKey(registryId);
}

function volcCredentials() {
  return {
    accessKeyId: envTrim('VOLCENGINE_ACCESS_KEY'),
    secretAccessKey: envTrim('VOLCENGINE_SECRET_KEY'),
  };
}

async function readJsonSafe(resp) {
  const text = await resp.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * @param {string} action CVSync2AsyncSubmitTask | CVSync2AsyncGetResult
 * @param {Record<string, unknown>} payload
 */
export async function callJimengVisualApi(action, payload) {
  const host = jimengVisualHost();
  const version = jimengVisualVersion();
  const query = { Action: action, Version: version };
  const body = JSON.stringify(payload ?? {});
  const { accessKeyId, secretAccessKey } = volcCredentials();
  const signed = signVolcengineRequest({
    method: 'POST',
    host,
    path: '/',
    query,
    body,
    accessKeyId,
    secretAccessKey,
    region: jimengVisualRegion(),
    service: jimengVisualService(),
  });

  const url = `https://${host}/?Action=${encodeURIComponent(action)}&Version=${encodeURIComponent(version)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Host: signed.host,
      'Content-Type': signed.contentType,
      'X-Date': signed.xDate,
      'X-Content-Sha256': signed.xContentSha256,
      Authorization: signed.authorization,
    },
    body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const data = await readJsonSafe(resp);
  return { ok: resp.ok, status: resp.status, data };
}

function parseDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const m = /^data:([^;,]+)?;base64,(.+)$/i.exec(raw);
  if (!m) return null;
  return m[2].trim();
}

async function referenceImageToBase64(entry) {
  const s = String(entry || '').trim();
  if (!s) return null;
  if (s.startsWith('data:')) return parseDataUrl(s);
  if (s.startsWith('http://') || s.startsWith('https://')) {
    const resp = await fetch(s, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`参考图下载失败 (${resp.status})`);
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf.toString('base64');
  }
  return s;
}

/**
 * @param {object} input
 * @param {string} input.registryId
 * @param {string} [input.prompt]
 * @param {number} [input.width]
 * @param {number} [input.height]
 * @param {string[]} [input.referenceImages]
 * @param {Record<string, unknown>} [input.extra]
 */
export async function buildJimengSubmitPayload(input, reqKey) {
  const payload = {
    req_key: reqKey,
    ...(input.extra && typeof input.extra === 'object' ? input.extra : {}),
  };
  if (input.prompt != null && String(input.prompt).trim()) {
    payload.prompt = String(input.prompt).trim();
  }
  if (input.width != null && Number.isFinite(Number(input.width))) {
    payload.width = Math.floor(Number(input.width));
  }
  if (input.height != null && Number.isFinite(Number(input.height))) {
    payload.height = Math.floor(Number(input.height));
  }
  const refs = Array.isArray(input.referenceImages) ? input.referenceImages : [];
  if (refs.length > 0) {
    const binaryList = [];
    for (const ref of refs) {
      const b64 = await referenceImageToBase64(ref);
      if (b64) binaryList.push(b64);
    }
    if (binaryList.length === 1) payload.binary_data_base64 = binaryList[0];
    else if (binaryList.length > 1) payload.binary_data_base64 = binaryList;
  }
  return payload;
}

/**
 * @param {object} input JimengSubmitInput
 * @returns {Promise<{ ok: true, taskId: string } | { ok: false, status: number, body: object }>}
 */
export async function submitJimengTask(input) {
  const registryId = String(input?.registryId || '').trim();
  if (!registryId) {
    return { ok: false, status: 400, body: { error: '缺少 registryId' } };
  }
  const resolved = resolveJimengReqKey(registryId);
  if (!resolved) {
    return {
      ok: false,
      status: 400,
      body: { error: `未知或未 verified 的 registryId: ${registryId}`, code: 'JIMENG_REGISTRY_UNKNOWN' },
    };
  }
  let payload;
  try {
    payload = await buildJimengSubmitPayload(input, resolved.reqKey);
  } catch (e) {
    return {
      ok: false,
      status: 400,
      body: { error: e instanceof Error ? e.message : String(e) },
    };
  }
  try {
    const upstream = await callJimengVisualApi('CVSync2AsyncSubmitTask', payload);
    const code = upstream.data?.code;
    if (code === 10000 && upstream.data?.data?.task_id) {
      return { ok: true, taskId: String(upstream.data.data.task_id) };
    }
    return {
      ok: false,
      status: upstream.status >= 400 ? upstream.status : 502,
      body: {
        error: upstream.data?.message || '即梦 Submit 失败',
        code: code ?? 'JIMENG_UPSTREAM_ERROR',
        message: upstream.data?.message,
        upstream: upstream.data,
      },
    };
  } catch (e) {
    return {
      ok: false,
      status: 502,
      body: {
        error: `即梦 upstream fetch failed: ${e instanceof Error ? e.message : String(e)}`,
        code: 'JIMENG_UPSTREAM_FETCH_FAILED',
      },
    };
  }
}

/**
 * 归一化 Poll 结果（站内契约）。
 * @param {unknown} upstream
 */
export function normalizeJimengPollResult(upstream) {
  const root = upstream && typeof upstream === 'object' ? upstream : {};
  const code = root.code;
  const data = root.data && typeof root.data === 'object' ? root.data : {};
  const statusRaw = String(data.status || '').toLowerCase();

  if (code != null && code !== 10000) {
    return {
      status: 'failed',
      code: Number(code),
      message: String(root.message || 'upstream rejected'),
    };
  }

  if (statusRaw === 'done') {
    const images = Array.isArray(data.image_urls)
      ? data.image_urls.filter(Boolean).map(String)
      : Array.isArray(data.binary_data_base64)
        ? data.binary_data_base64.map(String)
        : data.binary_data_base64
          ? [String(data.binary_data_base64)]
          : undefined;
    const videoUrl = data.video_url ? String(data.video_url) : undefined;
    return {
      status: 'done',
      ...(images?.length ? { images } : {}),
      ...(videoUrl ? { videoUrl } : {}),
    };
  }

  if (statusRaw === 'failed' || statusRaw === 'error') {
    return {
      status: 'failed',
      code: Number(data.code ?? code ?? 0),
      message: String(data.message || root.message || 'task failed'),
    };
  }

  if (statusRaw === 'running' || statusRaw === 'processing') {
    return { status: 'running', ...(data.progress != null ? { progress: Number(data.progress) } : {}) };
  }

  return { status: 'pending' };
}

function acquirePollSlot(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return { ok: true, release: () => {} };
  const cur = pollCountByUser.get(uid) || 0;
  if (cur >= MAX_CONCURRENT_POLLS_PER_USER) {
    return {
      ok: false,
      body: {
        error: '轮询并发过高，请稍后重试',
        code: 'JIMENG_POLL_CONCURRENCY_EXCEEDED',
        maxConcurrent: MAX_CONCURRENT_POLLS_PER_USER,
      },
    };
  }
  pollCountByUser.set(uid, cur + 1);
  return {
    ok: true,
    release: () => {
      const n = (pollCountByUser.get(uid) || 1) - 1;
      if (n <= 0) pollCountByUser.delete(uid);
      else pollCountByUser.set(uid, n);
    },
  };
}

/**
 * @param {string} taskId
 * @param {string} registryId
 * @param {{ userId?: string | null }} [opts]
 */
export async function pollJimengTask(taskId, registryId, opts = {}) {
  const tid = String(taskId || '').trim();
  const rid = String(registryId || '').trim();
  if (!tid) return { ok: false, status: 400, body: { error: '缺少 taskId' } };
  if (!rid) return { ok: false, status: 400, body: { error: '缺少 registryId' } };

  const resolved = resolveJimengReqKey(rid);
  if (!resolved) {
    return {
      ok: false,
      status: 400,
      body: { error: `未知或未 verified 的 registryId: ${rid}`, code: 'JIMENG_REGISTRY_UNKNOWN' },
    };
  }

  const slot = acquirePollSlot(opts.userId);
  if (!slot.ok) return { ok: false, status: 429, body: slot.body };

  try {
    const upstream = await callJimengVisualApi('CVSync2AsyncGetResult', {
      req_key: resolved.reqKey,
      task_id: tid,
    });
    const normalized = normalizeJimengPollResult(upstream.data);
    if (normalized.status === 'failed' && upstream.data?.code !== 10000) {
      return { ok: true, status: 200, body: normalized };
    }
    if (upstream.data?.code != null && upstream.data.code !== 10000 && normalized.status !== 'failed') {
      return {
        ok: true,
        status: 200,
        body: {
          status: 'failed',
          code: Number(upstream.data.code),
          message: String(upstream.data.message || 'upstream rejected'),
        },
      };
    }
    return { ok: true, status: 200, body: normalized };
  } catch (e) {
    return {
      ok: false,
      status: 502,
      body: {
        error: `即梦 poll fetch failed: ${e instanceof Error ? e.message : String(e)}`,
        code: 'JIMENG_UPSTREAM_FETCH_FAILED',
      },
    };
  } finally {
    slot.release();
  }
}

/** 测试用：重置内存 poll 计数 */
export function resetJimengPollCountersForTests() {
  pollCountByUser.clear();
}
