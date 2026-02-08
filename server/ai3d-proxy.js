/**
 * 腾讯混元生3D API 代理（解决浏览器 CORS）
 * 使用官方 tencentcloud-sdk-nodejs-common 做 TC3 签名，避免手写签名错误。
 * 用法：TENCENT_SECRET_ID=xxx TENCENT_SECRET_KEY=xxx node server/ai3d-proxy.js
 * 默认端口 9001，前端设置 VITE_TENCENT_PROXY=http://localhost:9001
 *
 * 额外：GET /model?url=<encoded-url> 代理拉取 3D 模型文件，解决预览时 CORS（Failed to fetch）。
 */
import http from 'http';
import { CommonClient } from 'tencentcloud-sdk-nodejs-common';

const PORT = Number(process.env.PORT) || 9001;
const AI3D_ENDPOINT = 'ai3d.tencentcloudapi.com';
const AI3D_VERSION = '2025-05-13';
const AI3D_REGION = 'ap-guangzhou';

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

function sendJson(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s, 'utf8') });
  res.end(s);
}

/** GET /model?url=<encoded-url>：代理拉取 3D 文件，解决预览 CORS */
async function handleModelProxy(req, res, parsedUrl) {
  const urlEnc = parsedUrl.searchParams?.get('url') || (new URL(req.url || '', 'http://localhost').searchParams.get('url'));
  if (!urlEnc) {
    sendJson(res, 400, { error: 'Missing query: url' });
    return;
  }
  let targetUrl;
  try {
    targetUrl = decodeURIComponent(urlEnc);
  } catch {
    sendJson(res, 400, { error: 'Invalid url encoding' });
    return;
  }
  if (!/^https?:\/\//i.test(targetUrl)) {
    sendJson(res, 400, { error: 'url must be http or https' });
    return;
  }
  try {
    const fetchRes = await fetch(targetUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'AssetCutter-AI3D-Proxy/1.0' },
    });
    if (!fetchRes.ok) {
      sendJson(res, fetchRes.status, { error: `Upstream ${fetchRes.status}`, url: targetUrl.slice(0, 80) });
      return;
    }
    const contentType = fetchRes.headers.get('content-type') || 'application/octet-stream';
    const buf = await fetchRes.arrayBuffer();
    if (buf.byteLength > MAX_MODEL_SIZE) {
      sendJson(res, 413, { error: 'Model file too large', max: MAX_MODEL_SIZE });
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': buf.byteLength,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(Buffer.from(buf));
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.error('[ai3d-proxy] /model fetch error:', msg);
    sendJson(res, 502, { error: 'Failed to fetch model', detail: msg });
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
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
      const result = await forwardToTencent(action, payload, secretId, secretKey);
      sendJson(res, 200, result);
    } catch (e) {
      const msg = e?.message ?? String(e);
      const code = e?.code ?? 'Unknown';
      console.error('[ai3d-proxy] 请求失败:', code, msg);
      if (!res.headersSent) {
        sendJson(res, 500, { error: msg, code });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`[ai3d-proxy] http://localhost:${PORT} (TENCENT_SECRET_ID set: ${!!process.env.TENCENT_SECRET_ID})`);
});
