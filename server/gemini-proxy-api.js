/**
 * Gemini 代理（仅 /proxy/gemini/*）：供前端在无浏览器 Key 或长任务场景下走后端。
 * 原「批量出图 Job /jobs」已移除；环境变量名仍可与旧部署兼容（BULK_IMAGE_PORT 等）。
 *
 * 用法：GEMINI_API_KEY=xxx node server/gemini-proxy-api.js
 * 前端：VITE_BULK_IMAGE_API=http://localhost:9002
 */
import http from 'http';
import { GoogleGenAI } from '@google/genai';

const PORT = Number(process.env.BULK_IMAGE_PORT || process.env.GEMINI_PROXY_PORT || process.env.PORT) || 9002;
const BIND_HOST = (process.env.BULK_IMAGE_BIND_HOST || '0.0.0.0').trim() || '0.0.0.0';
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const IMAGE_REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_IMAGE_REQUEST_TIMEOUT_MS) || 120_000;

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];

function parseAllowedOrigins() {
  const raw = (process.env.PROXY_ALLOWED_ORIGINS || '').trim();
  if (!raw) return new Set(DEFAULT_ALLOWED_ORIGINS);
  if (raw === '*') return null;
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

const allowedOrigins = parseAllowedOrigins();

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins === null) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
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
    return true;
  }
  return false;
}

function sendJson(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s, 'utf8') });
  res.end(s);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function normalizeSecret(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\uFEFF/g, '').replace(/\r\n?/g, '').trim();
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
    ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: model || 'gemini-2.5-flash',
      contents,
      config: mergedConfig,
    });
    const text = typeof response.text === 'string' ? response.text : '';
    const candidates = response.candidates || response.response?.candidates || [];
    return { text, candidates };
  } finally {
    keySlot.release?.();
  }
}

const GEMINI_ASYNC_JOB_TTL_MS = Number(process.env.GEMINI_ASYNC_JOB_TTL_MS) || 60 * 60 * 1000;
const geminiAsyncJobs = new Map();
const GEMINI_ASYNC_PROXY_MAX_CONCURRENT = Number(process.env.GEMINI_ASYNC_PROXY_MAX_CONCURRENT) || 4;
let geminiProxyInFlight = 0;
const geminiProxyWaiters = [];

function acquireGeminiProxySlot() {
  if (geminiProxyInFlight < GEMINI_ASYNC_PROXY_MAX_CONCURRENT) {
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

const GEMINI_ASYNC_JOB_MAX_WAIT_MS = Number(process.env.GEMINI_ASYNC_JOB_MAX_WAIT_MS) || 590_000;

function sweepGeminiAsyncJobs() {
  const now = Date.now();
  for (const [id, job] of geminiAsyncJobs) {
    if (now - job.createdAt > GEMINI_ASYNC_JOB_TTL_MS) geminiAsyncJobs.delete(id);
  }
}

function createGeminiAsyncJob(model, contents, config) {
  sweepGeminiAsyncJobs();
  const id = `gasync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  geminiAsyncJobs.set(id, {
    id,
    status: 'pending',
    createdAt: Date.now(),
    result: null,
    error: null,
  });
  const GEMINI_PROXY_MAX_ATTEMPTS = Number(process.env.GEMINI_PROXY_RETRIES) || 15;
  setImmediate(async () => {
    const job = geminiAsyncJobs.get(id);
    if (!job) return;
    job.status = 'running';
    const startedAt = Date.now();
    let lastErr;
    for (let attempt = 0; attempt < GEMINI_PROXY_MAX_ATTEMPTS; attempt++) {
      try {
        if (Date.now() - startedAt > GEMINI_ASYNC_JOB_MAX_WAIT_MS) {
          throw new Error(`Gemini 异步任务最大等待超时（>${GEMINI_ASYNC_JOB_MAX_WAIT_MS}ms）`);
        }
        const result = await withGeminiProxySlot(() => proxyGenerateContent(model, contents, config));
        const j = geminiAsyncJobs.get(id);
        if (!j) return;
        j.status = 'completed';
        j.result = result;
        j.updatedAt = Date.now();
        return;
      } catch (e) {
        lastErr = e;
        const shouldRetry = attempt < GEMINI_PROXY_MAX_ATTEMPTS - 1 && isRetryable(e);
        if (!shouldRetry) break;
        const delay = Math.min(30_000, 5000 * Math.pow(2, attempt));
        console.warn(`[gemini-proxy] async retry id=${id} attempt=${attempt + 1} delay=${delay}ms`);
        await sleep(delay);
      }
    }
    const j = geminiAsyncJobs.get(id);
    if (!j) return;
    j.status = 'failed';
    j.error = lastErr?.message ?? String(lastErr);
    j.updatedAt = Date.now();
    console.error(`[gemini-proxy] async failed id=${id} error=${j.error}`);
  });
  return id;
}

function isRetryable(e) {
  const msg = String((e && e.message) || e);
  if (/429|503|504|overloaded|UNAVAILABLE|DEADLINE_EXCEEDED|Deadline expired|500|INTERNAL|Internal error|high demand|try again later/i.test(msg)) return true;
  const code = e && e.code;
  const status = e && e.status;
  if (code === 504 || code === 503 || code === 429 || status === 'DEADLINE_EXCEEDED' || status === 'UNAVAILABLE') return true;
  try {
    const j = typeof msg === 'string' && msg.startsWith('{') ? JSON.parse(msg) : null;
    if (j?.error?.code === 504 || j?.error?.code === 503 || j?.error?.status === 'DEADLINE_EXCEEDED' || j?.error?.status === 'UNAVAILABLE') return true;
  } catch (_) {
    /* ignore */
  }
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('error', reject);
    req.on('end', () => {
      if (size > maxBytes) reject(new Error('Body too large'));
      else resolve(body);
    });
  });
}

const GEMINI_ASYNC_PATH = '/proxy/gemini/async';

const server = http.createServer(async (req, res) => {
  const corsOk = applyCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
      const body = await readBody(req, MAX_BODY_BYTES);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        sendError(res, 400, 'Invalid JSON body');
        return;
      }
      const { model, contents, config } = parsed || {};
      if (!model || !contents) {
        sendError(res, 400, 'Missing model or contents');
        return;
      }
      const key = normalizeSecret(process.env.GEMINI_API_KEY || '');
      if (!GEMINI_API_KEY_POOL.length && !key) {
        sendError(res, 500, 'No Gemini API key (env GEMINI_API_KEY)');
        return;
      }
      const jobId = createGeminiAsyncJob(model, contents, config);
      sendJson(res, 202, { jobId, status: 'pending' });
    } catch (e) {
      sendError(res, 500, e?.message ?? String(e));
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
    sendJson(res, 200, { status: job.status });
    return;
  }

  if (path === '/proxy/gemini/generate-content' && req.method === 'POST') {
    try {
      const body = await readBody(req, MAX_BODY_BYTES);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        sendError(res, 400, 'Invalid JSON body');
        return;
      }
      const { model, contents, config } = parsed || {};
      if (!model || !contents) {
        sendError(res, 400, 'Missing model or contents');
        return;
      }
      try {
        const response = await proxyGenerateContent(model, contents, config);
        sendJson(res, 200, response);
      } catch (e) {
        const msg = e?.message ?? String(e);
        console.error('[gemini-proxy] generate-content error:', msg);
        sendError(res, 500, msg);
      }
    } catch {
      sendError(res, 500, 'Request error');
    }
    return;
  }

  if (path === '/healthz' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'gemini-proxy-api',
      geminiAsyncJobs: geminiAsyncJobs.size,
      geminiProxyInFlight,
    });
    return;
  }

  sendJson(res, 404, {
    error:
      'Not found. POST /proxy/gemini/async + GET /proxy/gemini/async/:jobId; POST /proxy/gemini/generate-content; GET /healthz',
  });
});

server.listen(PORT, BIND_HOST, () => {
  console.log(`[gemini-proxy-api] http://${BIND_HOST}:${PORT}`);
});
