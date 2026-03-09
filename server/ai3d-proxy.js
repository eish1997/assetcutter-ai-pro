/**
 * 腾讯混元生3D API 代理（解决浏览器 CORS）
 * 使用官方 tencentcloud-sdk-nodejs-common 做 TC3 签名，避免手写签名错误。
 * 用法：TENCENT_SECRET_ID=xxx TENCENT_SECRET_KEY=xxx node server/ai3d-proxy.js
 * 默认端口 9001，前端设置 VITE_TENCENT_PROXY=http://localhost:9001
 *
 * 额外：GET /model?url=<encoded-url> 代理拉取 3D 模型文件，解决预览时 CORS（Failed to fetch）。
 */
import http from 'http';
import https from 'https';
import dns from 'dns/promises';
import { CommonClient } from 'tencentcloud-sdk-nodejs-common';

const PORT = Number(process.env.PORT) || 9001;
const BIND_HOST = (process.env.PROXY_BIND_HOST || '127.0.0.1').trim() || '127.0.0.1';
const AI3D_ENDPOINT = 'ai3d.tencentcloudapi.com';
const AI3D_VERSION = '2025-05-13';
const AI3D_REGION = 'ap-guangzhou';
const MODEL_REQUEST_TIMEOUT_MS = Number(process.env.MODEL_PROXY_TIMEOUT_MS) || 60_000;
const MAX_MODEL_REDIRECTS = Number(process.env.MODEL_PROXY_MAX_REDIRECTS) || 3;
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];
const ALLOWED_ACTIONS = new Set([
  'SubmitHunyuanTo3DProJob',
  'QueryHunyuanTo3DProJob',
  'SubmitHunyuanTo3DRapidJob',
  'QueryHunyuanTo3DRapidJob',
  'Convert3DFormat',
  'SubmitReduceFaceJob',
  'DescribeReduceFaceJob',
  'SubmitTextureTo3DJob',
  'DescribeTextureTo3DJob',
  'SubmitHunyuanTo3DUVJob',
  'DescribeHunyuanTo3DUVJob',
  'SubmitHunyuan3DPartJob',
  'QueryHunyuan3DPartJob',
  'SubmitProfileTo3DJob',
  'DescribeProfileTo3DJob',
]);

/** 规范化密钥：去除 BOM、首尾空白、换行，避免 .env 导致签名失败 */
function normalizeSecret(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\uFEFF/g, '').replace(/\r\n?/g, '').trim();
}

function forwardToTencent(action, payload, secretId, secretKey) {
  const credential = {
    secretId: normalizeSecret(secretId),
    secretKey: normalizeSecret(secretKey),
  };
  const client = new CommonClient(AI3D_ENDPOINT, AI3D_VERSION, {
    credential,
    region: AI3D_REGION,
  });
  return client.request(action, payload);
}

const MAX_BODY = 15 * 1024 * 1024; // 15MB
const MAX_MODEL_SIZE = 256 * 1024 * 1024; // 256MB for 3D model proxy（支持 100MB+ 大模型）

function parseAllowedOrigins() {
  const raw = (process.env.PROXY_ALLOWED_ORIGINS || '').trim();
  if (!raw) return new Set(DEFAULT_ALLOWED_ORIGINS);
  if (raw === '*') return null;
  return new Set(raw.split(',').map((item) => item.trim()).filter(Boolean));
}

function parseAllowedModelHosts() {
  return new Set(
    (process.env.MODEL_PROXY_ALLOWED_HOSTS || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

const allowedOrigins = parseAllowedOrigins();
const allowedModelHosts = parseAllowedModelHosts();
const proxyAuthToken = normalizeSecret(process.env.PROXY_AUTH_TOKEN || '');

function sendJson(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s, 'utf8') });
  res.end(s);
}

function normalizeIp(address) {
  if (typeof address !== 'string') return '';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function isLoopbackIp(address) {
  const normalized = normalizeIp(address);
  return normalized === '127.0.0.1' || normalized === '::1';
}

function isPrivateIp(address) {
  address = normalizeIp(address);
  if (!address) return true;
  if (isLoopbackIp(address)) return true;
  if (address.startsWith('10.') || address.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) return true;
  if (address.startsWith('169.254.')) return true;
  if (address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true;
  return false;
}

function isIpLiteral(hostname) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':');
}

function hasValidProxyToken(req) {
  const header = req.headers['x-proxy-token'];
  const provided = Array.isArray(header) ? header[0] : header;
  return !!proxyAuthToken && provided === proxyAuthToken;
}

function isLocalRequest(req) {
  return isLoopbackIp(req.socket.remoteAddress);
}

function ensureAuthorizedRequest(req, res) {
  if (isLocalRequest(req) || hasValidProxyToken(req)) return true;
  sendJson(res, 401, { error: 'Proxy authentication required' });
  return false;
}

async function resolveAllowedModelAddress(target) {
  const hostname = target.hostname.toLowerCase();
  if (!hostname) throw new Error('Model host is not allowed');
  if (allowedModelHosts.size > 0) {
    const matched = [...allowedModelHosts].some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
    if (!matched) throw new Error('Model host is not allowed');
  }
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Model host is not allowed');
  }
  if (isIpLiteral(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Model host is not allowed');
    return { address: hostname, family: hostname.includes(':') ? 6 : 4 };
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) {
    throw new Error('Model host is not allowed');
  }
  const normalized = addresses.map((entry) => ({ address: normalizeIp(entry.address), family: entry.family }));
  if (normalized.some((entry) => isPrivateIp(entry.address))) {
    throw new Error('Model host is not allowed');
  }
  return normalized[0];
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins === null) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
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

function getHeaderValue(headers, key) {
  const value = headers[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function requestModelWithPinnedAddress(target, resolvedAddress) {
  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: {
        'User-Agent': 'AssetCutter-AI3D-Proxy/1.0',
        'Host': target.host,
      },
      servername: isHttps ? target.hostname : undefined,
      lookup: (_hostname, _options, callback) => callback(null, resolvedAddress.address, resolvedAddress.family),
    }, resolve);
    request.setTimeout(MODEL_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Model request timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

async function streamModelResponse(fetchRes, res) {
  const contentType = getHeaderValue(fetchRes.headers, 'content-type') || 'application/octet-stream';
  const contentLength = Number(getHeaderValue(fetchRes.headers, 'content-length') || 0);
  if (contentLength && contentLength > MAX_MODEL_SIZE) {
    fetchRes.destroy();
    sendJson(res, 413, { error: 'Model file too large', max: MAX_MODEL_SIZE });
    return;
  }
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    ...(contentLength ? { 'Content-Length': String(contentLength) } : {}),
  });

  let total = 0;
  fetchRes.on('data', (chunk) => {
    total += chunk.length;
    if (total > MAX_MODEL_SIZE) {
      fetchRes.destroy(new Error('Model file too large'));
      if (!res.destroyed) res.destroy(new Error('Model file too large'));
      return;
    }
    if (!res.write(chunk)) {
      fetchRes.pause();
    }
  });
  res.on('drain', () => fetchRes.resume());
  fetchRes.on('end', () => {
    if (!res.destroyed) res.end();
  });
  fetchRes.on('error', (error) => {
    if (!res.destroyed) {
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchModelWithRedirectGuard(target) {
  let current = target;
  for (let redirectCount = 0; redirectCount <= MAX_MODEL_REDIRECTS; redirectCount++) {
    if (!/^https?:$/i.test(current.protocol)) {
      throw new Error('url must be http or https');
    }
    const resolvedAddress = await resolveAllowedModelAddress(current);
    const fetchRes = await requestModelWithPinnedAddress(current, resolvedAddress);
    const status = fetchRes.statusCode || 502;
    if (!isRedirectStatus(status)) {
      return fetchRes;
    }
    const location = getHeaderValue(fetchRes.headers, 'location');
    fetchRes.resume();
    if (!location) {
      throw new Error('Redirect location is missing');
    }
    current = new URL(location, current);
  }
  throw new Error('Too many redirects');
}

/** GET /model?url=<encoded-url>：代理拉取 3D 文件，解决预览 CORS */
async function handleModelProxy(req, res, parsedUrl) {
  const urlEnc = parsedUrl.searchParams?.get('url') || (new URL(req.url || '', 'http://localhost').searchParams.get('url'));
  if (!urlEnc) {
    sendJson(res, 400, { error: 'Missing query: url' });
    return;
  }
  const targetUrl = urlEnc;
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    sendJson(res, 400, { error: 'Invalid target URL' });
    return;
  }
  if (!/^https?:$/i.test(target.protocol)) {
    sendJson(res, 400, { error: 'url must be http or https' });
    return;
  }
  try {
    const fetchRes = await fetchModelWithRedirectGuard(target);
    const status = fetchRes.statusCode || 502;
    if (status < 200 || status >= 300) {
      fetchRes.resume();
      sendJson(res, status, { error: `Upstream ${status}`, url: targetUrl.slice(0, 80) });
      return;
    }
    await streamModelResponse(fetchRes, res);
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.error('[ai3d-proxy] /model fetch error:', msg);
    if (!res.headersSent) {
      const status = msg === 'Model host is not allowed' ? 403 : msg === 'url must be http or https' ? 400 : 502;
      sendJson(res, status, { error: 'Failed to fetch model' });
    }
  }
}

const server = http.createServer(async (req, res) => {
  const corsAllowed = applyCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Proxy-Token');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    if (!corsAllowed) {
      sendJson(res, 403, { error: 'Origin not allowed' });
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }
  if (!corsAllowed) {
    sendJson(res, 403, { error: 'Origin not allowed' });
    return;
  }
  if (!ensureAuthorizedRequest(req, res)) {
    return;
  }

  const path = (req.url || '/').split('?')[0];
  const parsedUrl = new URL(req.url || '/', 'http://localhost');

  if (path === '/model' && req.method === 'GET') {
    await handleModelProxy(req, res, parsedUrl);
    return;
  }

  if (path !== '/' && path !== '') {
    sendJson(res, 404, { error: 'POST / with body { action, payload }; GET /model?url=... for 3D file proxy' });
    return;
  }

  if (req.method === 'GET') {
    sendJson(res, 200, { ok: true, message: 'ai3d-proxy is running', port: PORT, modelProxy: 'GET /model?url=<encoded-url>' });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const rawSecretId = process.env.TENCENT_SECRET_ID;
  const rawSecretKey = process.env.TENCENT_SECRET_KEY;
  const secretId = normalizeSecret(rawSecretId ?? '');
  const secretKey = normalizeSecret(rawSecretKey ?? '');
  if (!secretId || !secretKey) {
    sendJson(res, 500, { error: 'Missing TENCENT_SECRET_ID or TENCENT_SECRET_KEY (check .env.local or env)' });
    return;
  }

  let body = '';
  let bodySize = 0;
  req.on('data', (chunk) => {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY) {
      req.destroy();
      return;
    }
    body += chunk.toString('utf8');
  });
  req.on('error', () => {
    if (!res.headersSent) sendJson(res, 500, { error: 'Request error' });
  });
  req.on('end', async () => {
    if (bodySize > MAX_BODY) {
      sendJson(res, 413, { error: 'Request body too large' });
      return;
    }
    try {
      const parsed = JSON.parse(body);
      const { action, payload } = parsed;
      if (!action || payload === undefined) {
        sendJson(res, 400, { error: 'action and payload required' });
        return;
      }
      if (!ALLOWED_ACTIONS.has(action)) {
        sendJson(res, 403, { error: 'action is not allowed' });
        return;
      }
      const result = await forwardToTencent(action, payload, secretId, secretKey);
      sendJson(res, 200, result);
    } catch (e) {
      const msg = e?.message ?? String(e);
      const code = e?.code ?? 'Unknown';
      console.error('[ai3d-proxy] 请求失败:', code, msg);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Tencent request failed', code });
      }
    }
  });
});

server.listen(PORT, BIND_HOST, () => {
  console.log(`[ai3d-proxy] http://${BIND_HOST}:${PORT} (TENCENT_SECRET_ID set: ${!!process.env.TENCENT_SECRET_ID}, auth required for non-local: ${!!proxyAuthToken})`);
});
