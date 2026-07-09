/**
 * Gemini 代理（仅 /proxy/gemini/*）：供前端在无浏览器 Key 或长任务场景下走后端。
 * 原「批量出图 Job /jobs」已移除；环境变量名仍可与旧部署兼容（BULK_IMAGE_PORT 等）。
 *
 * 用法：GEMINI_API_KEY=xxx node server/gemini-proxy-api.js
 * 前端：VITE_BULK_IMAGE_API=http://localhost:9002
 *
 * Vertex AI：请求 JSON 带 aiBackend: "vertex" 时走 GCP（需 VERTEX_PROJECT_ID 或 GOOGLE_CLOUD_PROJECT、ADC）。
 * 详见 docs/VERTEX_AI_INTEGRATION.md
 */
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { GoogleGenAI } from '@google/genai';
import {
  GEMINI_PROXY_MAX_BODY_BYTES as MAX_BODY_BYTES,
  BODY_TOO_LARGE_MESSAGE,
  readBodyUtf8,
} from './http-limits.js';
import {
  isFairnessEnabled,
  resolveFairnessKey,
  fairnessTryEnqueue,
  fairnessDequeueForRun,
  fairnessOnAsyncJobFinished,
  fairnessOnJobEvicted,
  fairnessHealthSnapshot,
  fairnessSyncEnter,
  fairnessSyncLeave,
  fairnessQueueMetaForJob,
  parseFairnessTaskEnvelope,
  getDiskOverrideInt,
} from './gemini-proxy-fairness.js';
import { initGeminiFairnessConfigLoader, resolveGeminiFairnessConfigSource } from './gemini-fairness-config-store.js';
import { extractUsageMetadata } from './gemini-proxy-usage.js';
import {
  assertGeminiProxyCreditsGate,
  estimatedCreditsFromProxyBody,
  isGeminiProxyCreditsGateEnabled,
} from './gemini-proxy-credits-gate.js';
import {
  geminiProxyMaxAttempts,
  geminiProxyRetryDelayMs,
  isRetryable,
  isUpstreamRateLimitError,
} from './gemini-proxy-retry.js';

/** 与 auth-api 一致：本地访问 Google API 常需 TRIPO_PROXY / HTTPS_PROXY（见 .env.local） */
const GEMINI_OUTBOUND_PROXY = String(
  process.env.TRIPO_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''
).trim();
if (GEMINI_OUTBOUND_PROXY) {
  try {
    setGlobalDispatcher(new ProxyAgent(GEMINI_OUTBOUND_PROXY));
  } catch (e) {
    console.warn('[gemini-proxy-api] outbound proxy init failed:', e instanceof Error ? e.message : e);
  }
}

/** 监听端口：优先专用变量，避免与 .env.local 里给 ai3d 等用的通用 `PORT` 冲突 */
const PORT =
  Number(process.env.GEMINI_PROXY_PORT || process.env.BULK_IMAGE_PORT || process.env.PORT) || 9002;
const BIND_HOST = (process.env.BULK_IMAGE_BIND_HOST || '0.0.0.0').trim() || '0.0.0.0';
const IMAGE_REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_IMAGE_REQUEST_TIMEOUT_MS) || 120_000;
const VERTEX_IMAGE_REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_VERTEX_IMAGE_TIMEOUT_MS) || 600_000;
const TOAPIS_BASE_URL = String(process.env.TOAPIS_BASE_URL || 'https://toapis.com/v1').trim().replace(/\/+$/, '');
const TOAPIS_API_KEY = normalizeSecret(process.env.TOAPIS_API_KEY || '');
const ENABLE_TOAPIS_FALLBACK = String(process.env.ENABLE_TOAPIS_FALLBACK || '').trim().toLowerCase() === 'true';
const TOAPIS_IMAGE_POLL_MS = Number(process.env.TOAPIS_IMAGE_POLL_MS) || 3000;
const TOAPIS_IMAGE_MAX_WAIT_MS = Number(process.env.TOAPIS_IMAGE_MAX_WAIT_MS) || 600_000;

/** 本地 dev + 已知生产前端 Origin；与 `AUTH_ALLOWED_ORIGINS` 对齐，避免仅配 auth 却漏配 gemini-proxy */
const BUILTIN_PROXY_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://app.adrazzo.com',
  'https://scripts.adrazzo.com',
  'https://assetcutter-ai-pro.vercel.app',
  'https://assetcutter-web.onrender.com',
];

function parseAllowedOrigins() {
  const raw = (process.env.PROXY_ALLOWED_ORIGINS || '').trim();
  if (raw === '*') return null;
  const merged = new Set(BUILTIN_PROXY_ALLOWED_ORIGINS);
  if (raw) {
    for (const s of raw.split(',')) {
      const t = s.trim();
      if (t) merged.add(t);
    }
  }
  return merged;
}

const allowedOrigins = parseAllowedOrigins();

function isDevLoopbackOrigin(origin) {
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') return false;
  try {
    const h = new URL(origin).hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
}

function applyCors(req, res) {
  const rawOrigin = req.headers.origin;
  /** Node/undici 跨域 fetch 可能送 Origin: null（opaque origin），不应按字面量拒掉 */
  const origin = rawOrigin && String(rawOrigin).toLowerCase() !== 'null' ? rawOrigin : '';
  /** 前端 bulkFetch 使用 credentials:include（积分 Cookie / fairness）；须回显 Origin 且允许凭据，否则浏览器报 Failed to fetch */
  const allowCredentialsForOrigin = () => {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  };
  if (allowedOrigins === null) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      allowCredentialsForOrigin();
    } else res.setHeader('Access-Control-Allow-Origin', '*');
    return true;
  }
  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return true;
  }
  if (allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    allowCredentialsForOrigin();
    return true;
  }
  if (isDevLoopbackOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    allowCredentialsForOrigin();
    return true;
  }
  if (String(process.env.GEMINI_PROXY_DEBUG_CORS || '').trim() === '1') {
    console.warn('[gemini-proxy-api] CORS reject', { rawOrigin, origin, allowed: [...(allowedOrigins || [])] });
  }
  return false;
}

function sendJson(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s, 'utf8'),
    /** 避免 CDN/浏览器缓存异步任务轮询的 404（否则会反复出现 Job not found or expired） */
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
  });
  res.end(s);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function sendFairnessReject(res, info) {
  const retryAfterSec = info.retryAfterSec != null ? Number(info.retryAfterSec) : undefined;
  const body = {
    error: info.error || 'rate_limited',
    message: info.reason || info.error || 'rate_limited',
    ...(retryAfterSec != null && Number.isFinite(retryAfterSec) ? { retryAfterSec } : {}),
  };
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
  };
  if (retryAfterSec != null && Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    headers['Retry-After'] = String(Math.ceil(retryAfterSec));
  }
  const s = JSON.stringify(body);
  res.writeHead(info.status || 429, {
    ...headers,
    'Content-Length': Buffer.byteLength(s, 'utf8'),
  });
  res.end(s);
}

function formatErrorDetail(err) {
  const e = err || {};
  const msg = (e && e.message) ? String(e.message) : String(e);
  const parts = [msg];
  const cause = e && e.cause;
  if (cause) {
    const cObj = typeof cause === 'object' ? cause : null;
    const cMsg = cObj && cObj.message ? String(cObj.message) : String(cause);
    if (cMsg && cMsg !== msg) parts.push(`cause=${cMsg}`);
    if (cObj && cObj.code) parts.push(`causeCode=${String(cObj.code)}`);
    if (cObj && cObj.errno) parts.push(`causeErrno=${String(cObj.errno)}`);
  }
  if (e && e.code) parts.push(`code=${String(e.code)}`);
  return parts.join(' ');
}

function normalizeSecret(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\uFEFF/g, '').replace(/\r\n?/g, '').trim();
}

function vertexProjectId() {
  return (process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '').trim();
}

function vertexLocation() {
  return (process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'global').trim();
}

function isVertexConfigured() {
  return Boolean(vertexProjectId());
}

function adcCredentialPath() {
  return normalizeSecret(process.env.GOOGLE_APPLICATION_CREDENTIALS || '');
}

function isAdcLikelyConfigured() {
  const adcPath = adcCredentialPath();
  if (adcPath) {
    try {
      if (fs.existsSync(adcPath)) return true;
    } catch {
      /* ignore */
    }
  }
  const inline = normalizeSecret(
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
      process.env.GCP_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      ''
  );
  if (inline) return true;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    const localAdcPath = path.join(home, '.config', 'gcloud', 'application_default_credentials.json');
    try {
      if (fs.existsSync(localAdcPath)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function vertexConfigGuideMessage() {
  return (
    'Vertex 生图尚未就绪：请在运行本代理的环境中配置 Google Cloud 项目（环境变量 VERTEX_PROJECT_ID 或 GOOGLE_CLOUD_PROJECT）、区域（可选 VERTEX_LOCATION，默认 global），并完成应用默认凭据 ADC。' +
    ' 可将服务账号 JSON 写入 GOOGLE_APPLICATION_CREDENTIALS_JSON（或设置 GOOGLE_APPLICATION_CREDENTIALS 指向密钥文件）。完整说明见仓库 docs/VERTEX_AI_INTEGRATION.md。'
  );
}

/**
 * Render / 部分 PaaS 不便挂载 JSON 文件路径，可将服务账号 JSON 整段写入环境变量。
 * 启动时写入临时文件并设置 GOOGLE_APPLICATION_CREDENTIALS，供 @google/genai ADC 使用。
 * 优先级：已有且存在的文件路径 > 内联 JSON 环境变量。
 */
function ensureAdcFromJsonEnv() {
  const existingPath = adcCredentialPath();
  if (existingPath) {
    try {
      if (fs.existsSync(existingPath)) return;
    } catch {
      /* ignore */
    }
  }
  const raw = normalizeSecret(
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
      process.env.GCP_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      ''
  );
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
  } catch {
    console.warn('[gemini-proxy-api] GOOGLE_APPLICATION_CREDENTIALS_JSON / GCP_SERVICE_ACCOUNT_JSON is not valid JSON; ignoring');
    return;
  }
  const tmp = path.join(os.tmpdir(), `gcp-adc-${process.pid}.json`);
  try {
    fs.writeFileSync(tmp, raw, 'utf8');
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
    console.log('[gemini-proxy-api] ADC: using inline JSON env → temp file for Application Default Credentials');
  } catch (e) {
    console.warn('[gemini-proxy-api] ADC: could not write temp credentials file:', e?.message || e);
  }
}

ensureAdcFromJsonEnv();

/** Vertex 使用 ADC；lazy 按 project+location 重建 */
let vertexAiClient = null;
let vertexAiClientCacheKey = '';

function getVertexAI() {
  const project = vertexProjectId();
  if (!project) {
    throw new Error('Vertex: set VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT');
  }
  const location = vertexLocation();
  const key = `${project}\0${location}`;
  if (!vertexAiClient || vertexAiClientCacheKey !== key) {
    vertexAiClient = new GoogleGenAI({ vertexai: true, project, location });
    vertexAiClientCacheKey = key;
  }
  return vertexAiClient;
}

async function proxyVertexGenerateContent(model, contents, config) {
  const safeConfig = { ...(config || {}) };
  if (safeConfig.abortSignal) delete safeConfig.abortSignal;
  const timeout = Math.max(
    Number(safeConfig?.httpOptions?.timeout) || IMAGE_REQUEST_TIMEOUT_MS,
    VERTEX_IMAGE_REQUEST_TIMEOUT_MS
  );
  const mergedConfig = {
    ...safeConfig,
    httpOptions: { ...(safeConfig.httpOptions || {}), timeout },
  };
  const ai = getVertexAI();
  const response = await ai.models.generateContent({
    model: model || 'gemini-2.5-flash',
    contents,
    config: mergedConfig,
  });
  const text = typeof response.text === 'string' ? response.text : '';
  const candidates = response.candidates || response.response?.candidates || [];
  const usageMetadata = extractUsageMetadata(response);
  return { text, candidates, usageMetadata };
}

function isGeminiNetworkError(detail) {
  return /fetch failed|UND_ERR_CONNECT_TIMEOUT|connect timeout|ENETUNREACH|ECONNRESET|ETIMEDOUT/i.test(detail);
}

function isImageGenerationModel(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('flash-image') || m.includes('pro-image')) return true;
  return /-image$/.test(m) && !m.includes('flash-preview') && !m.includes('pro-preview');
}

function parseContents(contents) {
  if (Array.isArray(contents)) return contents;
  if (contents && typeof contents === 'object' && Array.isArray(contents.parts)) {
    return [{ role: 'user', parts: contents.parts }];
  }
  return [{ role: 'user', parts: [{ text: String(contents ?? '') }] }];
}

function partToOpenAIContent(p) {
  if (p?.inlineData?.data) {
    const mime = p.inlineData.mimeType || 'image/jpeg';
    return { type: 'image_url', image_url: { url: `data:${mime};base64,${p.inlineData.data}` } };
  }
  return { type: 'text', text: String(p?.text ?? '') };
}

function buildOpenAIMessages(contents, systemInstruction) {
  const turns = parseContents(contents);
  const messages = [];
  if (systemInstruction && String(systemInstruction).trim()) {
    messages.push({ role: 'system', content: String(systemInstruction).trim() });
  }
  for (const t of turns) {
    const role = t.role === 'model' ? 'assistant' : 'user';
    const parts = Array.isArray(t.parts) ? t.parts : [];
    const openaiParts = parts
      .map(partToOpenAIContent)
      .filter((x) => (x.type === 'text' ? x.text !== '' : true));
    if (!openaiParts.length) continue;
    const content = openaiParts.length === 1 && openaiParts[0].type === 'text' ? openaiParts[0].text : openaiParts;
    messages.push({ role, content });
  }
  return messages;
}

async function uploadDataUrlToToapis(dataUrl, signal) {
  const m = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/i);
  if (!m) throw new Error('ToAPIs 上传失败：无效 data URL');
  const mime = m[1] || 'image/jpeg';
  const b64 = m[2] || '';
  const bytes = Buffer.from(b64, 'base64');
  const blob = new Blob([bytes], { type: mime });
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
  const form = new FormData();
  form.append('file', blob, `upload.${ext}`);
  const res = await fetch(`${TOAPIS_BASE_URL}/uploads/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOAPIS_API_KEY}` },
    body: form,
    signal,
  });
  const json = await res.json().catch(() => ({}));
  const url = json?.data?.url;
  if (!res.ok || !url) throw new Error(json?.message || `ToAPIs 上传失败（${res.status}）`);
  return String(url);
}

async function pollToapisImageTask(taskId, signal) {
  const deadline = Date.now() + TOAPIS_IMAGE_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${TOAPIS_BASE_URL}/images/generations/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${TOAPIS_API_KEY}` },
      signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `ToAPIs 查询任务失败（${res.status}）`);
    if (json?.status === 'completed') {
      const url = json?.result?.data?.[0]?.url;
      if (!url) throw new Error('ToAPIs 任务完成但未返回图片 URL');
      return String(url);
    }
    if (json?.status === 'failed') throw new Error(json?.error?.message || 'ToAPIs 图像生成失败');
    await sleep(TOAPIS_IMAGE_POLL_MS);
  }
  throw new Error('ToAPIs 图像生成超时');
}

async function fetchImageAsBase64(imageUrl, signal) {
  const res = await fetch(imageUrl, { signal });
  if (!res.ok) throw new Error(`ToAPIs 拉取图片失败（${res.status}）`);
  const mime = res.headers.get('content-type') || 'image/png';
  const ab = await res.arrayBuffer();
  return { mimeType: mime, data: Buffer.from(ab).toString('base64') };
}

async function proxyViaToapis(model, contents, config) {
  if (!TOAPIS_API_KEY) {
    throw new Error('代理后端到 Google Gemini 网络不通，且未配置 TOAPIS_API_KEY');
  }
  const safeConfig = { ...(config || {}) };
  if (safeConfig.abortSignal) delete safeConfig.abortSignal;
  const signal = config?.abortSignal;
  if (isImageGenerationModel(model)) {
    const turns = parseContents(contents);
    const parts = turns.find((t) => t.role === 'user')?.parts || turns[0]?.parts || [];
    const texts = [];
    const dataUrls = [];
    for (const p of parts) {
      if (p?.text) texts.push(String(p.text));
      if (p?.inlineData?.data) {
        const mime = p.inlineData.mimeType || 'image/jpeg';
        dataUrls.push(`data:${mime};base64,${p.inlineData.data}`);
      }
    }
    const prompt = [String(safeConfig.systemInstruction || '').trim(), texts.join('\n').trim()]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 1000);
    if (!prompt) throw new Error('ToAPIs 生图提示词为空');
    const image_urls = [];
    for (const d of dataUrls) image_urls.push(await uploadDataUrlToToapis(d, signal));
    const body = {
      model,
      prompt,
      size: String(safeConfig?.imageConfig?.aspectRatio || '1:1'),
      n: 1,
      ...(image_urls.length ? { image_urls } : {}),
    };
    const createRes = await fetch(`${TOAPIS_BASE_URL}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOAPIS_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const createJson = await createRes.json().catch(() => ({}));
    if (!createRes.ok) throw new Error(createJson?.error || createJson?.message || `ToAPIs 创建任务失败（${createRes.status}）`);
    const taskId = createJson?.id;
    if (!taskId) throw new Error('ToAPIs 未返回任务 ID');
    const outUrl = await pollToapisImageTask(taskId, signal);
    const image = await fetchImageAsBase64(outUrl, signal);
    return { text: '', candidates: [{ content: { parts: [{ inlineData: image }] } }] };
  }

  const messages = buildOpenAIMessages(contents, safeConfig.systemInstruction);
  const body = {
    model,
    messages,
    ...(safeConfig.responseMimeType === 'application/json' ? { response_format: { type: 'json_object' } } : {}),
  };
  const res = await fetch(`${TOAPIS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOAPIS_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(raw || `ToAPIs Chat 失败（${res.status}）`);
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('ToAPIs Chat 响应不是合法 JSON');
  }
  const text = parsed?.choices?.[0]?.message?.content || '';
  const usageMetadata = extractUsageMetadata(parsed);
  return {
    text: String(text),
    candidates: [{ content: { parts: [{ text: String(text) }] } }],
    usageMetadata,
  };
}

const GEMINI_API_KEYS_RAW = (process.env.GEMINI_API_KEYS || '').trim();
const GEMINI_API_KEY_POOL = Array.from(
  new Set(
    GEMINI_API_KEYS_RAW
      ? GEMINI_API_KEYS_RAW.split(',').map((s) => normalizeSecret(s)).filter(Boolean)
      : []
  )
);
const GEMINI_KEY_POOL_MAX_IN_FLIGHT_PER_KEY = Number(process.env.GEMINI_KEY_POOL_MAX_IN_FLIGHT_PER_KEY) || 3;

const geminiKeyPoolInFlight = new Map();
let geminiKeyPoolRoundRobin = 0;
const geminiKeyPoolWaiters = [];

function getKeyInFlight(key) {
  return geminiKeyPoolInFlight.get(key) || 0;
}

function acquireGeminiKeySlotSync() {
  if (!GEMINI_API_KEY_POOL.length) return null;
  const len = GEMINI_API_KEY_POOL.length;
  for (let i = 0; i < len; i++) {
    const idx = (geminiKeyPoolRoundRobin + i) % len;
    const key = GEMINI_API_KEY_POOL[idx];
    if (getKeyInFlight(key) < GEMINI_KEY_POOL_MAX_IN_FLIGHT_PER_KEY) {
      geminiKeyPoolRoundRobin = (idx + 1) % len;
      geminiKeyPoolInFlight.set(key, getKeyInFlight(key) + 1);
      return key;
    }
  }
  return null;
}

async function acquireGeminiKeySlot() {
  if (!GEMINI_API_KEY_POOL.length) {
    const single = normalizeSecret(process.env.GEMINI_API_KEY || '');
    if (!single) return { key: '', release: () => {} };
    return { key: single, release: () => {} };
  }
  for (;;) {
    const key = acquireGeminiKeySlotSync();
    if (key) {
      return {
        key,
        release: () => {
          geminiKeyPoolInFlight.set(key, Math.max(0, getKeyInFlight(key) - 1));
          const next = geminiKeyPoolWaiters.shift();
          if (next) next();
        },
      };
    }
    await new Promise((resolve) => geminiKeyPoolWaiters.push(resolve));
  }
}

async function proxyGenerateContent(model, contents, config) {
  const keySlot = await acquireGeminiKeySlot();
  const key = keySlot.key;
  if (!key) throw new Error('No Gemini API key (env GEMINI_API_KEY or GEMINI_API_KEYS)');
  const safeConfig = { ...(config || {}) };
  if (safeConfig.abortSignal) delete safeConfig.abortSignal;
  const timeout = Number(safeConfig?.httpOptions?.timeout) || IMAGE_REQUEST_TIMEOUT_MS;
  const mergedConfig = {
    ...safeConfig,
    httpOptions: { ...(safeConfig.httpOptions || {}), timeout },
  };
  let ai;
  try {
    // 必须显式 vertexai:false：若 .env 里设了 GOOGLE_GENAI_USE_VERTEXAI=true（为 Vertex 调试），
    // @google/genai 会把未声明 vertexai 的构造当成「走 Vertex」，用 AI Studio Key 调 GCP 端即报
    // “API keys are not supported… Expected OAuth2 access token”。
    ai = new GoogleGenAI({ apiKey: key, vertexai: false });
    const response = await ai.models.generateContent({
      model: model || 'gemini-2.5-flash',
      contents,
      config: mergedConfig,
    });
    const text = typeof response.text === 'string' ? response.text : '';
    const candidates = response.candidates || response.response?.candidates || [];
    const usageMetadata = extractUsageMetadata(response);
    return { text, candidates, usageMetadata };
  } catch (e) {
    const detail = formatErrorDetail(e);
    if (isGeminiNetworkError(detail)) {
      if (ENABLE_TOAPIS_FALLBACK && TOAPIS_API_KEY) {
        console.warn('[gemini-proxy] Gemini 网络不可达，自动回退 ToAPIs');
        return proxyViaToapis(model, contents, { ...mergedConfig, abortSignal: config?.abortSignal });
      }
      throw new Error(`${detail}（代理后端到 Google Gemini 网络不通。请为该进程配置 HTTPS_PROXY/HTTP_PROXY。若确需兜底，可设置 ENABLE_TOAPIS_FALLBACK=true 并配置 TOAPIS_API_KEY）`);
    }
    throw e;
  } finally {
    keySlot.release?.();
  }
}

const GEMINI_ASYNC_JOB_TTL_MS = Number(process.env.GEMINI_ASYNC_JOB_TTL_MS) || 60 * 60 * 1000;
const geminiAsyncJobs = new Map();
function getGeminiAsyncProxyMaxConcurrent() {
  return getDiskOverrideInt('GEMINI_ASYNC_PROXY_MAX_CONCURRENT', 4, 1, 64);
}

let geminiProxyInFlight = 0;
const geminiProxyWaiters = [];

function acquireGeminiProxySlot() {
  const cap = getGeminiAsyncProxyMaxConcurrent();
  if (geminiProxyInFlight < cap) {
    geminiProxyInFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    geminiProxyWaiters.push(resolve);
  }).then(() => {
    geminiProxyInFlight++;
  });
}

function releaseGeminiProxySlot() {
  geminiProxyInFlight = Math.max(0, geminiProxyInFlight - 1);
  const next = geminiProxyWaiters.shift();
  if (next) next();
}

async function withGeminiProxySlot(fn) {
  await acquireGeminiProxySlot();
  try {
    return await fn();
  } finally {
    releaseGeminiProxySlot();
  }
}

const GEMINI_ASYNC_JOB_MAX_WAIT_MS = Number(process.env.GEMINI_ASYNC_JOB_MAX_WAIT_MS) || 300_000;
const GEMINI_ASYNC_BATCH_MAX_ITEMS = Number(process.env.GEMINI_ASYNC_BATCH_MAX_ITEMS) || 20;

function asyncJobPollPayload(job, jobId) {
  const payload = { status: job.status };
  if (job.status === 'queued' || job.status === 'running') {
    const queueMeta = fairnessQueueMetaForJob(jobId, job.status);
    if (queueMeta) payload.queueMeta = queueMeta;
  }
  return payload;
}

function sweepGeminiAsyncJobs() {
  const now = Date.now();
  for (const [id, job] of geminiAsyncJobs) {
    if (now - job.createdAt > GEMINI_ASYNC_JOB_TTL_MS) {
      fairnessOnJobEvicted(id);
      geminiAsyncJobs.delete(id);
    }
  }
}

function pumpFairAsyncWorkers() {
  if (!isFairnessEnabled()) return;
  for (;;) {
    const d = fairnessDequeueForRun((jid) => geminiAsyncJobs.has(jid));
    if (!d) break;
    const job = geminiAsyncJobs.get(d.jobId);
    if (!job) {
      fairnessOnAsyncJobFinished(d.jobId);
      continue;
    }
    job.status = 'running';
    if (job.jobKind === 'batch') {
      setImmediate(() => runGeminiAsyncBatchJobBody(d.jobId));
    } else {
      setImmediate(() => runGeminiAsyncJob(d.jobId));
    }
  }
}

async function runGeminiAsyncJob(jobId) {
  try {
    const job = geminiAsyncJobs.get(jobId);
    if (!job) return;
    if (!isFairnessEnabled()) job.status = 'running';
    const { model, contents, config, useVertex } = job;
    const overloadMaxAttempts = Number(process.env.GEMINI_PROXY_RETRIES) || 15;
    const startedAt = Date.now();
    let lastErr;
    let attempt = 0;
    for (;;) {
      try {
        if (Date.now() - startedAt > GEMINI_ASYNC_JOB_MAX_WAIT_MS) {
          throw new Error(`Gemini 异步任务最大等待超时（>${GEMINI_ASYNC_JOB_MAX_WAIT_MS}ms）`);
        }
        const result = await withGeminiProxySlot(() =>
          useVertex ? proxyVertexGenerateContent(model, contents, config) : proxyGenerateContent(model, contents, config)
        );
        const j = geminiAsyncJobs.get(jobId);
        if (!j) return;
        j.status = 'completed';
        j.result = result;
        j.updatedAt = Date.now();
        return;
      } catch (e) {
        lastErr = e;
        const maxAttempts = geminiProxyMaxAttempts(e, overloadMaxAttempts);
        const shouldRetry = attempt < maxAttempts - 1 && isRetryable(e);
        if (!shouldRetry) break;
        const delay = geminiProxyRetryDelayMs(e, attempt);
        const kind = isUpstreamRateLimitError(e) ? 'upstream_rate_limit' : 'overload';
        console.warn(
          `[gemini-proxy] async retry id=${jobId} kind=${kind} attempt=${attempt + 1}/${maxAttempts - 1} delay=${delay}ms`
        );
        await sleep(delay);
        attempt += 1;
      }
    }
    const j = geminiAsyncJobs.get(jobId);
    if (!j) return;
    j.status = 'failed';
    j.error = formatErrorDetail(lastErr);
    j.updatedAt = Date.now();
    console.error(`[gemini-proxy] async failed id=${jobId} error=${j.error}`);
  } finally {
    fairnessOnAsyncJobFinished(jobId);
    if (isFairnessEnabled()) pumpFairAsyncWorkers();
  }
}

function parseCostWeightFromBody(parsed) {
  const fm = parsed && parsed.fairnessMeta;
  if (!fm || typeof fm !== 'object') return 1;
  const w = Number(fm.costWeight);
  if (w === 2 || w === 5) return w;
  return 1;
}

function createGeminiAsyncJob(model, contents, config, useVertex, fairnessKey, costWeight, envelopeId = null) {
  sweepGeminiAsyncJobs();
  const id = `gasync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  if (isFairnessEnabled()) {
    geminiAsyncJobs.set(id, {
      id,
      status: 'queued',
      createdAt: Date.now(),
      model,
      contents,
      config,
      useVertex,
      result: null,
      error: null,
    });
    const enq = fairnessTryEnqueue(id, fairnessKey, costWeight, envelopeId);
    if (!enq.ok) {
      geminiAsyncJobs.delete(id);
      return { type: 'reject', info: enq };
    }
    pumpFairAsyncWorkers();
    return { type: 'ok', id };
  }
  geminiAsyncJobs.set(id, {
    id,
    status: 'pending',
    createdAt: Date.now(),
    model,
    contents,
    config,
    useVertex,
    result: null,
    error: null,
  });
  setImmediate(() => runGeminiAsyncJob(id));
  return { type: 'ok', id };
}

async function runGeminiAsyncBatchJobBody(jobId) {
  try {
    const job = geminiAsyncJobs.get(jobId);
    if (!job) return;
    if (!isFairnessEnabled()) job.status = 'running';
    const { batchItems: items, useVertex } = job;
    let results;
    if (isFairnessEnabled()) {
      results = [];
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        try {
          const result = await runGeminiWithRetries(item.model, item.contents, item.config, useVertex);
          results.push({ ok: true, result });
        } catch (e) {
          const error = formatErrorDetail(e);
          console.error(`[gemini-proxy] async batch item failed id=${jobId} index=${index} error=${error}`);
          results.push({ ok: false, error });
        }
      }
    } else {
      results = await Promise.all(
        items.map(async (item, index) => {
          try {
            const result = await runGeminiWithRetries(item.model, item.contents, item.config, useVertex);
            return { ok: true, result };
          } catch (e) {
            const error = formatErrorDetail(e);
            console.error(`[gemini-proxy] async batch item failed id=${jobId} index=${index} error=${error}`);
            return { ok: false, error };
          }
        })
      );
    }
    const j = geminiAsyncJobs.get(jobId);
    if (!j) return;
    j.status = 'completed';
    j.result = { items: results };
    j.updatedAt = Date.now();
  } catch (e) {
    const j = geminiAsyncJobs.get(jobId);
    if (!j) return;
    j.status = 'failed';
    j.error = formatErrorDetail(e);
    j.updatedAt = Date.now();
    console.error(`[gemini-proxy] async batch failed id=${jobId} error=${j.error}`);
  } finally {
    fairnessOnAsyncJobFinished(jobId);
    if (isFairnessEnabled()) pumpFairAsyncWorkers();
  }
}

function createGeminiAsyncBatchJob(normalizedItems, useVertex, fairnessKey, envelopeId = null) {
  sweepGeminiAsyncJobs();
  const id = `gasync-batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const n = normalizedItems.length;
  const costWeight = Math.min(10, Math.max(1, Math.ceil(n / 5)));
  if (isFairnessEnabled()) {
    geminiAsyncJobs.set(id, {
      id,
      status: 'queued',
      createdAt: Date.now(),
      jobKind: 'batch',
      batchItems: normalizedItems,
      useVertex,
      result: null,
      error: null,
    });
    const enq = fairnessTryEnqueue(id, fairnessKey, costWeight, envelopeId);
    if (!enq.ok) {
      geminiAsyncJobs.delete(id);
      return { type: 'reject', info: enq };
    }
    pumpFairAsyncWorkers();
    return { type: 'ok', id };
  }
  geminiAsyncJobs.set(id, {
    id,
    status: 'pending',
    createdAt: Date.now(),
    jobKind: 'batch',
    batchItems: normalizedItems,
    useVertex,
    result: null,
    error: null,
  });
  setImmediate(() => runGeminiAsyncBatchJobBody(id));
  return { type: 'ok', id };
}

async function runGeminiWithRetries(model, contents, config, useVertex) {
  const overloadMaxAttempts = Number(process.env.GEMINI_PROXY_RETRIES) || 15;
  const startedAt = Date.now();
  let lastErr;
  let attempt = 0;
  for (;;) {
    try {
      if (Date.now() - startedAt > GEMINI_ASYNC_JOB_MAX_WAIT_MS) {
        throw new Error(`Gemini 异步任务最大等待超时（>${GEMINI_ASYNC_JOB_MAX_WAIT_MS}ms）`);
      }
      return await withGeminiProxySlot(() =>
        useVertex ? proxyVertexGenerateContent(model, contents, config) : proxyGenerateContent(model, contents, config)
      );
    } catch (e) {
      lastErr = e;
      const maxAttempts = geminiProxyMaxAttempts(e, overloadMaxAttempts);
      const shouldRetry = attempt < maxAttempts - 1 && isRetryable(e);
      if (!shouldRetry) break;
      await sleep(geminiProxyRetryDelayMs(e, attempt));
      attempt += 1;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(formatErrorDetail(lastErr));
}


function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sendBodyReadError(res, e) {
  const msg = e?.message ?? String(e);
  if (msg === BODY_TOO_LARGE_MESSAGE) {
    sendError(res, 413, msg);
  } else {
    sendError(res, 500, msg);
  }
}

async function applyCreditsGateOrReject(req, res, parsed, fallbackCredits) {
  if (!isGeminiProxyCreditsGateEnabled()) return true;
  const est = estimatedCreditsFromProxyBody(parsed, fallbackCredits);
  try {
    const gate = await assertGeminiProxyCreditsGate(req, est);
    if (gate.ok) return true;
    sendJson(res, gate.status, gate.body);
    return false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[gemini-proxy] credits gate error:', msg);
    sendJson(res, 503, { error: '积分准入服务暂不可用', detail: msg });
    return false;
  }
}

const GEMINI_ASYNC_PATH = '/proxy/gemini/async';
const GEMINI_ASYNC_BATCH_PATH = '/proxy/gemini/async-batch';

const server = http.createServer(async (req, res) => {
  if (String(process.env.GEMINI_PROXY_DEBUG_CORS || '').trim() === '1' && req.method === 'POST') {
    console.warn('[gemini-proxy-api] POST', req.url, 'origin=', req.headers.origin);
  }
  const corsOk = applyCors(req, res);
  if (String(process.env.GEMINI_PROXY_DEBUG_CORS || '').trim() === '1' && req.method === 'POST') {
    console.warn('[gemini-proxy-api] corsOk=', corsOk, 'origin=', JSON.stringify(req.headers.origin));
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AC-Fairness-Key, X-AC-Fairness-Signature, X-AC-Client-Ip, X-AC-Credits-Reserve, X-AC-Credits-Gate-Signature, X-AC-Task-Envelope');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    if (!corsOk) sendJson(res, 403, { error: 'Origin not allowed' });
    else {
      res.writeHead(204);
      res.end();
    }
    return;
  }
  if (!corsOk) {
    sendJson(res, 403, { error: 'Origin not allowed' });
    return;
  }

  const path = (req.url || '/').split('?')[0];

  if (path === GEMINI_ASYNC_PATH && req.method === 'POST') {
    try {
      const body = await readBodyUtf8(req, MAX_BODY_BYTES);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        sendError(res, 400, 'Invalid JSON body');
        return;
      }
      const { model, contents, config, aiBackend } = parsed || {};
      if (!model || !contents) {
        sendError(res, 400, 'Missing model or contents');
        return;
      }
      if (!(await applyCreditsGateOrReject(req, res, parsed, 50))) return;
      const useVertex = aiBackend === 'vertex';
      const key = normalizeSecret(process.env.GEMINI_API_KEY || '');
      if (useVertex) {
        if (!isVertexConfigured()) {
          sendError(res, 500, vertexConfigGuideMessage());
          return;
        }
        if (!isAdcLikelyConfigured()) {
          sendError(res, 500, vertexConfigGuideMessage());
          return;
        }
      } else if (!GEMINI_API_KEY_POOL.length && !key && !(ENABLE_TOAPIS_FALLBACK && TOAPIS_API_KEY)) {
        sendError(res, 500, 'No backend key. Set GEMINI_API_KEY/GEMINI_API_KEYS');
        return;
      }
      let fairnessKey = 'anon:unused';
      if (isFairnessEnabled()) {
        const fr = resolveFairnessKey(req);
        if (!fr.ok) {
          sendJson(res, fr.status, { error: fr.error });
          return;
        }
        fairnessKey = fr.key;
      }
      const costWeight = parseCostWeightFromBody(parsed);
      const taskEnvelopeId = parseFairnessTaskEnvelope(req);
      const cr = createGeminiAsyncJob(model, contents, config, useVertex, fairnessKey, costWeight, taskEnvelopeId);
      if (cr.type === 'reject') {
        sendFairnessReject(res, cr.info);
        return;
      }
      sendJson(res, 202, { jobId: cr.id, status: isFairnessEnabled() ? 'queued' : 'pending' });
    } catch (e) {
      sendBodyReadError(res, e);
    }
    return;
  }

  if (path === GEMINI_ASYNC_BATCH_PATH && req.method === 'POST') {
    try {
      const body = await readBodyUtf8(req, MAX_BODY_BYTES);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        sendError(res, 400, 'Invalid JSON body');
        return;
      }
      const { items, aiBackend } = parsed || {};
      if (!Array.isArray(items) || items.length === 0) {
        sendError(res, 400, 'Missing items');
        return;
      }
      if (items.length > GEMINI_ASYNC_BATCH_MAX_ITEMS) {
        sendError(res, 400, `Too many items (>${GEMINI_ASYNC_BATCH_MAX_ITEMS})`);
        return;
      }
      const useVertex = aiBackend === 'vertex';
      const key = normalizeSecret(process.env.GEMINI_API_KEY || '');
      if (useVertex) {
        if (!isVertexConfigured()) {
          sendError(res, 500, vertexConfigGuideMessage());
          return;
        }
        if (!isAdcLikelyConfigured()) {
          sendError(res, 500, vertexConfigGuideMessage());
          return;
        }
      } else if (!GEMINI_API_KEY_POOL.length && !key && !(ENABLE_TOAPIS_FALLBACK && TOAPIS_API_KEY)) {
        sendError(res, 500, 'No backend key. Set GEMINI_API_KEY/GEMINI_API_KEYS');
        return;
      }
      const normalizedItems = items.map((item) => ({
        model: item?.model,
        contents: item?.contents,
        config: item?.config || {},
      }));
      if (normalizedItems.some((item) => !item.model || !item.contents)) {
        sendError(res, 400, 'Each item needs model and contents');
        return;
      }
      if (!(await applyCreditsGateOrReject(req, res, parsed, 50))) return;
      let fairnessKey = 'anon:unused';
      if (isFairnessEnabled()) {
        const fr = resolveFairnessKey(req);
        if (!fr.ok) {
          sendJson(res, fr.status, { error: fr.error });
          return;
        }
        fairnessKey = fr.key;
      }
      const taskEnvelopeId = parseFairnessTaskEnvelope(req);
      const cr = createGeminiAsyncBatchJob(normalizedItems, useVertex, fairnessKey, taskEnvelopeId);
      if (cr.type === 'reject') {
        sendFairnessReject(res, cr.info);
        return;
      }
      sendJson(res, 202, { jobId: cr.id, status: isFairnessEnabled() ? 'queued' : 'pending' });
    } catch (e) {
      sendBodyReadError(res, e);
    }
    return;
  }

  if (path.startsWith(`${GEMINI_ASYNC_PATH}/`) && req.method === 'GET') {
    const jobId = decodeURIComponent(path.slice(GEMINI_ASYNC_PATH.length + 1)).split('/')[0];
    if (!jobId || jobId.includes('..')) {
      sendError(res, 400, 'Invalid job id');
      return;
    }
    const job = geminiAsyncJobs.get(jobId);
    if (!job) {
      sendJson(res, 404, { error: 'Job not found or expired' });
      return;
    }
    if (job.status === 'completed') {
      sendJson(res, 200, { status: 'completed', result: job.result });
      return;
    }
    if (job.status === 'failed') {
      sendJson(res, 200, { status: 'failed', error: job.error || 'Unknown error' });
      return;
    }
    sendJson(res, 200, asyncJobPollPayload(job, jobId));
    return;
  }

  if (path.startsWith(`${GEMINI_ASYNC_BATCH_PATH}/`) && req.method === 'GET') {
    const jobId = decodeURIComponent(path.slice(GEMINI_ASYNC_BATCH_PATH.length + 1)).split('/')[0];
    if (!jobId || jobId.includes('..')) {
      sendError(res, 400, 'Invalid job id');
      return;
    }
    const job = geminiAsyncJobs.get(jobId);
    if (!job) {
      sendJson(res, 404, { error: 'Job not found or expired' });
      return;
    }
    if (job.status === 'completed') {
      sendJson(res, 200, { status: 'completed', result: job.result });
      return;
    }
    if (job.status === 'failed') {
      sendJson(res, 200, { status: 'failed', error: job.error || 'Unknown error' });
      return;
    }
    sendJson(res, 200, asyncJobPollPayload(job, jobId));
    return;
  }

  if (path === '/proxy/gemini/generate-content' && req.method === 'POST') {
    try {
      const body = await readBodyUtf8(req, MAX_BODY_BYTES);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        sendError(res, 400, 'Invalid JSON body');
        return;
      }
      const { model, contents, config, aiBackend } = parsed || {};
      if (!model || !contents) {
        sendError(res, 400, 'Missing model or contents');
        return;
      }
      const useVertex = aiBackend === 'vertex';
      if (useVertex && !isVertexConfigured()) {
        sendError(res, 500, vertexConfigGuideMessage());
        return;
      }
      if (useVertex && !isAdcLikelyConfigured()) {
        sendError(res, 500, vertexConfigGuideMessage());
        return;
      }
      if (!(await applyCreditsGateOrReject(req, res, parsed, 2))) return;
      let syncFairnessKey = null;
      if (isFairnessEnabled()) {
        const fr = resolveFairnessKey(req);
        if (!fr.ok) {
          sendJson(res, fr.status, { error: fr.error });
          return;
        }
        syncFairnessKey = fr.key;
      }
      try {
        let response;
        if (syncFairnessKey) {
          const taskEnvelopeId = parseFairnessTaskEnvelope(req);
          const syncSlot = await fairnessSyncEnter(syncFairnessKey, taskEnvelopeId);
          try {
            response = await runGeminiWithRetries(model, contents, config, useVertex);
          } finally {
            fairnessSyncLeave(syncFairnessKey, taskEnvelopeId, syncSlot.acquiredRunning);
          }
        } else {
          response = await runGeminiWithRetries(model, contents, config, useVertex);
        }
        sendJson(res, 200, response);
      } catch (e) {
        const msg = formatErrorDetail(e);
        console.error('[gemini-proxy] generate-content error:', msg);
        sendError(res, 500, msg);
      }
    } catch (e) {
      sendBodyReadError(res, e);
    }
    return;
  }

  if (path === '/healthz' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'gemini-proxy-api',
      geminiAsyncJobs: geminiAsyncJobs.size,
      geminiProxyInFlight,
      fairness: fairnessHealthSnapshot(),
      vertex: {
        configured: isVertexConfigured(),
        location: isVertexConfigured() ? vertexLocation() : null,
        adcLikelyConfigured: isAdcLikelyConfigured(),
      },
    });
    return;
  }

  sendJson(res, 404, {
    error:
      'Not found. POST /proxy/gemini/async or /proxy/gemini/async-batch (body optional aiBackend:vertex) + GET /proxy/gemini/async/:jobId or /proxy/gemini/async-batch/:jobId; POST /proxy/gemini/generate-content; GET /healthz',
  });
});

server.listen(PORT, BIND_HOST, async () => {
  try {
    await initGeminiFairnessConfigLoader();
  } catch (e) {
    console.warn('[gemini-proxy-api] fairness config loader init failed:', e instanceof Error ? e.message : String(e));
  }
  console.log(`[gemini-proxy-api] http://${BIND_HOST}:${PORT}`);
  console.log(
    `[gemini-proxy-api] creditsGate=${isGeminiProxyCreditsGateEnabled() ? 'on' : 'off'} (AUTH_API_BASE / session cookie → auth-api)`
  );
  console.log(
    `[gemini-proxy-api] GEMINI_FAIRNESS_ENABLED=${isFairnessEnabled() ? 'true' : 'false'} (see docs/Gemini代理-公平排队与每用户限流.md)`
  );
  console.log(`[gemini-proxy-api] GEMINI_FAIRNESS_CONFIG_SOURCE=${resolveGeminiFairnessConfigSource()}`);
  const vp = vertexProjectId();
  const vOk = isVertexConfigured();
  console.log(`[gemini-proxy-api] Vertex project: ${vp || '(unset)'}  configured=${vOk}  location=${vOk ? vertexLocation() : '—'}`);
  if (!vOk) {
    console.warn(
      '[gemini-proxy-api] Vertex is not configured (VERTEX_PROJECT_ID / GOOGLE_CLOUD_PROJECT empty). Requests with aiBackend:vertex will return 500. Set project id + ADC on this service — see docs/VERTEX_AI_INTEGRATION.md'
    );
  }
});
