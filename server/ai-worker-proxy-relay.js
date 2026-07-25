/**
 * auth-api 同源转发 ai-worker-proxy，避免浏览器跨域访问 onrender ai-worker-proxy 时 CORS 白名单遗漏。
 * 前端在 bulk 根与页面不同源且已配置 VITE_AUTH_API_BASE_URL 时走 /api/ai-worker-proxy/*。
 */
import { Agent, fetch as undiciFetch } from 'undici';
import { AI_WORKER_PROXY_MAX_BODY_BYTES, readBodyUtf8 } from './http-limits.js';

const directDispatcher = new Agent();

const SKIP_REQ_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'origin',
  'referer',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-dest',
]);

const SKIP_RESP_HEADERS = new Set(['content-encoding', 'transfer-encoding', 'content-length', 'connection']);

/** ? render.yaml / VITE_AI_WORKER_PROXY_API ????? */
const DEFAULT_PRODUCTION_AI_WORKER_PROXY_UPSTREAM = 'https://assetcutter-ai-worker-proxy.onrender.com';

function defaultAiWorkerProxyUpstream() {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  return isProd ? DEFAULT_PRODUCTION_AI_WORKER_PROXY_UPSTREAM : 'http://127.0.0.1:9002';
}

export function aiWorkerProxyUpstreamBase() {
  const raw = String(
    process.env.AI_WORKER_PROXY_UPSTREAM_URL ||
      process.env.AI_WORKER_PROXY_HEALTH_URL ||
      process.env.AI_WORKER_PROXY_BASE_URL ||
      process.env.GEMINI_PROXY_UPSTREAM_URL ||
      process.env.GEMINI_PROXY_HEALTH_URL ||
      process.env.GEMINI_PROXY_BASE_URL ||
      defaultAiWorkerProxyUpstream()
  )
    .trim()
    .replace(/\/+$/, '');
  return raw || defaultAiWorkerProxyUpstream();
}

export function aiWorkerProxyUpstreamDiagnostics() {
  const candidates = [
    ['AI_WORKER_PROXY_UPSTREAM_URL', process.env.AI_WORKER_PROXY_UPSTREAM_URL],
    ['AI_WORKER_PROXY_HEALTH_URL', process.env.AI_WORKER_PROXY_HEALTH_URL],
    ['AI_WORKER_PROXY_BASE_URL', process.env.AI_WORKER_PROXY_BASE_URL],
    ['GEMINI_PROXY_UPSTREAM_URL', process.env.GEMINI_PROXY_UPSTREAM_URL],
    ['GEMINI_PROXY_HEALTH_URL', process.env.GEMINI_PROXY_HEALTH_URL],
    ['GEMINI_PROXY_BASE_URL', process.env.GEMINI_PROXY_BASE_URL],
  ];
  const matched = candidates.find(([, value]) => String(value || '').trim());
  const base = aiWorkerProxyUpstreamBase();
  let origin = null;
  try {
    origin = new URL(base).origin;
  } catch {
    origin = base || null;
  }
  return {
    origin,
    source: matched ? matched[0] : 'default',
    legacyGeminiProxyEnvUsed: Boolean(matched?.[0]?.startsWith('GEMINI_PROXY_')),
    legacyGeminiProxyEnvPresent: candidates.some(([key, value]) => key.startsWith('GEMINI_PROXY_') && String(value || '').trim()),
    internalCompatibilityRoutes: [
      '/proxy/gemini/async',
      '/proxy/gemini/async-batch', // internal-only unless AI_WORKER_PROXY_ASYNC_BATCH_ENABLED
      '/proxy/gemini/generate-content',
    ],
  };
}

/** auth-api 可能设全局 TRIPO_PROXY/HTTPS_PROXY；loopback 须直连，否则 relay 报 fetch failed */
function isLoopbackHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function useDirectDispatcherForUrl(targetUrl) {
  try {
    return isLoopbackHost(new URL(targetUrl).hostname);
  } catch {
    return false;
  }
}

function sendRelayJson(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s, 'utf8'),
    'Cache-Control': 'no-store',
  });
  res.end(s);
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} upstreamPath e.g. `/healthz` or `/proxy/gemini/async`
 */
export async function relayAiWorkerProxyRequest(req, res, upstreamPath) {
  const method = String(req.method || 'GET').toUpperCase();
  const allowed = new Set(['GET', 'POST', 'HEAD', 'OPTIONS']);
  if (!allowed.has(method)) {
    sendRelayJson(res, 405, { error: `relay 不支持 ${method}` });
    return;
  }
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let search = '';
  try {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    search = urlObj.search || '';
  } catch {
    /* ignore */
  }

  const pathPart = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  const targetUrl = `${aiWorkerProxyUpstreamBase()}${pathPart}${search}`;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (SKIP_REQ_HEADERS.has(lk)) continue;
    if (v == null || v === '') continue;
    headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }

  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      body = await readBodyUtf8(req, AI_WORKER_PROXY_MAX_BODY_BYTES);
    } catch (e) {
      sendRelayJson(res, 413, {
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }
  }

  let upstream;
  try {
    upstream = await undiciFetch(targetUrl, {
      method,
      headers,
      body: body && body.length > 0 ? body : undefined,
      signal: AbortSignal.timeout(620_000),
      ...(useDirectDispatcherForUrl(targetUrl) ? { dispatcher: directDispatcher } : {}),
    });
  } catch (e) {
    sendRelayJson(res, 502, {
      error: 'ai-worker-proxy relay 无法连接上游',
      detail: e instanceof Error ? e.message : String(e),
      targetUrl,
    });
    return;
  }

  res.statusCode = upstream.status;
  upstream.headers.forEach((v, k) => {
    if (SKIP_RESP_HEADERS.has(k.toLowerCase())) return;
    try {
      res.setHeader(k, v);
    } catch {
      /* ignore invalid header */
    }
  });

  if (method === 'HEAD') {
    res.end();
    return;
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  if (!res.hasHeader('content-length')) {
    res.setHeader('Content-Length', String(buf.length));
  }
  res.end(buf);
}
