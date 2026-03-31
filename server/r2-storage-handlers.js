import { S3Client, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { findUserById, getWorkspaceQuotaBytesForUser } from './auth-store.js';
import {
  getTrackedBytesForKey,
  getWorkspaceUsedBytes,
  isBillableWorkspaceImageKey,
  registerBillableObjectAfterPut,
  replaceUserUsageFromScan,
  unregisterBillableObjectAfterDelete,
} from './workspace-storage-usage.js';

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];

function normalizeSecret(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\uFEFF/g, '').replace(/\r\n?/g, '').trim();
}

const R2_ACCOUNT_ID = () => normalizeSecret(process.env.R2_ACCOUNT_ID || '');
const R2_ACCESS_KEY_ID = () => normalizeSecret(process.env.R2_ACCESS_KEY_ID || '');
const R2_SECRET_ACCESS_KEY = () => normalizeSecret(process.env.R2_SECRET_ACCESS_KEY || '');
const R2_BUCKET = () => normalizeSecret(process.env.R2_BUCKET || '');
const R2_PUBLIC_BASE_URL = () => String(process.env.R2_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const AUTH_ME_URL = () => String(process.env.AUTH_ME_URL || 'http://127.0.0.1:9100/api/auth/me').trim();
const R2_ENFORCE_USER_SCOPE = () =>
  String(process.env.R2_ENFORCE_USER_SCOPE || 'true').trim().toLowerCase() !== 'false';
const R2_CAPABILITY_STORE_CATALOG_KEY = () =>
  String(process.env.R2_CAPABILITY_STORE_CATALOG_KEY || 'public/capability-store/catalog.json')
    .trim()
    .replace(/^\/+/, '');

export function isR2Configured() {
  return !!(R2_ACCOUNT_ID() && R2_ACCESS_KEY_ID() && R2_SECRET_ACCESS_KEY() && R2_BUCKET());
}

export function assertR2Config() {
  const missing = [];
  if (!R2_ACCOUNT_ID()) missing.push('R2_ACCOUNT_ID');
  if (!R2_ACCESS_KEY_ID()) missing.push('R2_ACCESS_KEY_ID');
  if (!R2_SECRET_ACCESS_KEY()) missing.push('R2_SECRET_ACCESS_KEY');
  if (!R2_BUCKET()) missing.push('R2_BUCKET');
  if (missing.length) {
    throw new Error(`缺少 R2 配置：${missing.join(', ')}`);
  }
}

function parseAllowedOrigins() {
  const raw = (process.env.PROXY_ALLOWED_ORIGINS || '').trim();
  if (!raw) return new Set(DEFAULT_ALLOWED_ORIGINS);
  if (raw === '*') return null;
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

const allowedOrigins = parseAllowedOrigins();

let _s3 = null;
function getS3() {
  if (!isR2Configured()) return null;
  if (!_s3) {
    _s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID()}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID(),
        secretAccessKey: R2_SECRET_ACCESS_KEY(),
      },
    });
  }
  return _s3;
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

function sendJson(res, status, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text, 'utf8'),
  });
  res.end(text);
}

function parsePathname(reqUrl) {
  return (reqUrl || '/').split('?')[0];
}

function safeObjectKey(raw) {
  const key = String(raw || '').trim().replace(/^\/+/, '');
  if (!key) throw new Error('objectKey 不能为空');
  if (key.includes('..')) throw new Error('objectKey 非法');
  return key;
}

function safeRelativeObjectPath(raw) {
  const key = String(raw || '').trim().replace(/^\/+/, '');
  if (!key) throw new Error('objectPath 不能为空');
  if (key.includes('..')) throw new Error('objectPath 非法');
  return key;
}

function toYmd(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function catalogRootPrefix() {
  const key = R2_CAPABILITY_STORE_CATALOG_KEY();
  const idx = key.lastIndexOf('/');
  if (idx < 0) return '';
  return key.slice(0, idx + 1);
}

async function streamBodyToString(body) {
  if (!body) return '';
  if (typeof body.transformToString === 'function') {
    return body.transformToString('utf-8');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    body.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    body.on('error', reject);
    body.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function getJsonObjectOrDefault(s3, objectKey, fallbackValue) {
  try {
    const got = await s3.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET(),
        Key: objectKey,
      })
    );
    const text = await streamBodyToString(got.Body);
    const parsed = JSON.parse(text || 'null');
    return parsed ?? fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let body = '';
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('error', reject);
    req.on('end', () => resolve(body));
  });
}

async function resolveSessionUserIdFetch(req) {
  if (!R2_ENFORCE_USER_SCOPE()) return null;
  const cookie = String(req.headers.cookie || '');
  if (!cookie) return null;
  try {
    const r = await fetch(AUTH_ME_URL(), { headers: { cookie } });
    if (!r.ok) return null;
    const data = await r.json();
    const id = data?.user?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

async function resolveSessionUserId(req, inject) {
  if (!R2_ENFORCE_USER_SCOPE()) return null;
  if (inject?.resolveSessionUserId) {
    return inject.resolveSessionUserId(req);
  }
  return resolveSessionUserIdFetch(req);
}

function userRootPrefix(userId) {
  return `users/${userId}/`;
}

function assertUserObjectKey(sessionUserId, objectKey) {
  if (!R2_ENFORCE_USER_SCOPE()) return;
  if (!sessionUserId) throw new Error('未登录');
  const prefix = userRootPrefix(sessionUserId);
  if (!objectKey.startsWith(prefix)) throw new Error('无权访问该对象路径');
}

function resolveListPrefix(sessionUserId, prefixRaw) {
  if (!R2_ENFORCE_USER_SCOPE()) return String(prefixRaw || '');
  if (!sessionUserId) throw new Error('未登录');
  const root = userRootPrefix(sessionUserId);
  let p = String(prefixRaw || '').trim().replace(/^\/+/, '');
  if (!p) return root;
  if (!p.startsWith(root)) throw new Error('列举路径必须在当前用户命名空间下');
  return p;
}

async function handleCreateUploadUrl(req, res, sessionUserId, s3) {
  const bodyText = await readBody(req);
  let body = {};
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
  }
  const objectKey = safeObjectKey(body.objectKey);
  try {
    assertUserObjectKey(sessionUserId, objectKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, msg === '未登录' ? 401 : 403, { error: msg });
    return;
  }
  const billable = !!(sessionUserId && isBillableWorkspaceImageKey(sessionUserId, objectKey));
  if (billable) {
    const declared = Math.floor(Number(body.contentLength));
    if (!Number.isFinite(declared) || declared < 1) {
      sendJson(res, 400, { error: '上传工作区图片必须提供 contentLength（字节）', code: 'CONTENT_LENGTH_REQUIRED' });
      return;
    }
    const dbUser = await findUserById(sessionUserId);
    if (!dbUser) {
      sendJson(res, 401, { error: '用户不存在' });
      return;
    }
    const quota = getWorkspaceQuotaBytesForUser(dbUser);
    const used = getWorkspaceUsedBytes(sessionUserId);
    const oldTracked = getTrackedBytesForKey(sessionUserId, objectKey);
    const projected = used - oldTracked + declared;
    if (projected > quota) {
      sendJson(res, 403, {
        error: '工作区云空间已满，无法上传该图片。新内容将仅保存在本机；请删除云端资源或联系管理员扩容。',
        code: 'STORAGE_QUOTA_EXCEEDED',
      });
      return;
    }
  }
  const contentType = String(body.contentType || 'application/octet-stream').trim() || 'application/octet-stream';
  const expiresIn = Math.min(parsePositiveInt(body.expiresIn, 600), 3600);

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET(),
    Key: objectKey,
    ContentType: contentType,
  });
  let uploadUrl;
  try {
    uploadUrl = await getSignedUrl(s3, command, { expiresIn });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[r2-storage-api] getSignedUrl(PutObject) failed:', detail);
    sendJson(res, 502, {
      error: 'R2 预签名失败：请核对 Cloudflare 控制台中的 Account ID、R2 API 令牌（Access Key / Secret）、Bucket 名称是否与 .env 一致。',
      detail,
    });
    return;
  }

  const pub = R2_PUBLIC_BASE_URL();
  sendJson(res, 200, {
    objectKey,
    contentType,
    expiresIn,
    uploadUrl,
    publicUrl: pub ? `${pub}/${encodeURIComponent(objectKey).replace(/%2F/g, '/')}` : null,
  });
}

async function handleCreateDownloadUrl(req, res, sessionUserId, s3) {
  const bodyText = await readBody(req);
  let body = {};
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
  }
  const objectKey = safeObjectKey(body.objectKey);
  try {
    assertUserObjectKey(sessionUserId, objectKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, msg === '未登录' ? 401 : 403, { error: msg });
    return;
  }
  const expiresIn = Math.min(parsePositiveInt(body.expiresIn, 600), 3600);

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET(),
    Key: objectKey,
  });
  let downloadUrl;
  try {
    downloadUrl = await getSignedUrl(s3, command, { expiresIn });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[r2-storage-api] getSignedUrl(GetObject) failed:', detail);
    sendJson(res, 502, {
      error: 'R2 预签名失败：请核对 Account ID、密钥与 Bucket。',
      detail,
    });
    return;
  }

  sendJson(res, 200, { objectKey, expiresIn, downloadUrl });
}

async function handleRegisterUpload(req, res, sessionUserId, s3) {
  const bodyText = await readBody(req);
  let body = {};
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
  }
  const objectKey = safeObjectKey(body.objectKey);
  try {
    assertUserObjectKey(sessionUserId, objectKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, msg === '未登录' ? 401 : 403, { error: msg });
    return;
  }
  const bucket = R2_BUCKET();
  let headSize = 0;
  try {
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      })
    );
    headSize = Number(head.ContentLength || 0);
  } catch {
    sendJson(res, 404, { error: '对象尚未写入或不存在，请稍后重试 register-upload' });
    return;
  }
  if (!isBillableWorkspaceImageKey(sessionUserId, objectKey)) {
    sendJson(res, 200, {
      ok: true,
      billable: false,
      usedBytes: getWorkspaceUsedBytes(sessionUserId),
    });
    return;
  }
  const dbUser = await findUserById(sessionUserId);
  if (!dbUser) {
    sendJson(res, 401, { error: '用户不存在' });
    return;
  }
  const quota = getWorkspaceQuotaBytesForUser(dbUser);
  const used = getWorkspaceUsedBytes(sessionUserId);
  const oldTracked = getTrackedBytesForKey(sessionUserId, objectKey);
  if (used - oldTracked + headSize > quota) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    } catch {
      /* ignore */
    }
    sendJson(res, 403, {
      error: '上传后超出工作区云配额，已丢弃该对象。',
      code: 'STORAGE_QUOTA_EXCEEDED',
      usedBytes: getWorkspaceUsedBytes(sessionUserId),
      quotaBytes: quota,
    });
    return;
  }
  const { ok, usedBytes } = registerBillableObjectAfterPut(sessionUserId, objectKey, headSize);
  if (!ok) {
    sendJson(res, 400, { error: '登记用量失败' });
    return;
  }
  sendJson(res, 200, { ok: true, billable: true, usedBytes, quotaBytes: quota });
}

async function handleListObjects(req, res, parsedUrl, sessionUserId, s3) {
  let prefix;
  try {
    prefix = resolveListPrefix(sessionUserId, parsedUrl.searchParams.get('prefix') || '');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, msg === '未登录' ? 401 : 403, { error: msg });
    return;
  }
  const continuationToken = String(parsedUrl.searchParams.get('continuationToken') || '');
  const maxKeys = Math.min(parsePositiveInt(parsedUrl.searchParams.get('maxKeys'), 50), 1000);

  const result = await s3.send(
    new ListObjectsV2Command({
      Bucket: R2_BUCKET(),
      Prefix: prefix || undefined,
      MaxKeys: maxKeys,
      ContinuationToken: continuationToken || undefined,
    })
  );

  const pub = R2_PUBLIC_BASE_URL();
  const items = (result.Contents || []).map((item) => ({
    key: item.Key || '',
    size: item.Size || 0,
    lastModified: item.LastModified ? item.LastModified.toISOString() : null,
    etag: item.ETag || null,
    publicUrl: pub && item.Key ? `${pub}/${encodeURIComponent(item.Key).replace(/%2F/g, '/')}` : null,
  }));

  sendJson(res, 200, {
    items,
    isTruncated: !!result.IsTruncated,
    nextContinuationToken: result.NextContinuationToken || null,
  });
}

async function handleHeadObject(req, res, objectKey, sessionUserId, s3) {
  try {
    assertUserObjectKey(sessionUserId, objectKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, msg === '未登录' ? 401 : 403, { error: msg });
    return;
  }
  await s3.send(
    new HeadObjectCommand({
      Bucket: R2_BUCKET(),
      Key: objectKey,
    })
  );
  sendJson(res, 200, { ok: true, objectKey });
}

async function handleDeleteObject(req, res, objectKey, sessionUserId, s3) {
  try {
    assertUserObjectKey(sessionUserId, objectKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, msg === '未登录' ? 401 : 403, { error: msg });
    return;
  }
  const bucket = R2_BUCKET();
  let headSize = 0;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    headSize = Number(head.ContentLength || 0);
  } catch {
    headSize = 0;
  }
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    })
  );
  const { usedBytes } = unregisterBillableObjectAfterDelete(sessionUserId, objectKey, headSize);
  sendJson(res, 200, { ok: true, objectKey, usedBytes });
}

async function handleCapabilityStoreObject(req, res, objectKey, s3) {
  const got = await s3.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET(),
      Key: objectKey,
    })
  );
  const text = await streamBodyToString(got.Body);
  const contentType = String(got.ContentType || '').toLowerCase();
  const isJson = contentType.includes('application/json') || objectKey.endsWith('.json');
  if (isJson) {
    let parsed = null;
    try {
      parsed = JSON.parse(text || 'null');
    } catch {
      sendJson(res, 500, { error: `能力商店对象 JSON 非法：${objectKey}` });
      return;
    }
    sendJson(res, 200, parsed);
    return;
  }
  res.writeHead(200, { 'Content-Type': got.ContentType || 'application/octet-stream' });
  res.end(text);
}

export async function publishCapabilityPresetToR2Catalog(adminUserId, preset) {
  const uid = String(adminUserId || '').trim();
  if (!uid) throw new Error('管理员身份无效');
  const p = preset && typeof preset === 'object' ? preset : null;
  if (!p) throw new Error('preset 无效');
  const pid = String(p.id || '').trim();
  const label = String(p.label || '').trim();
  if (!pid || !label) throw new Error('preset 缺少 id 或 label');
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const now = Date.now();
  const root = catalogRootPrefix() || 'public/capability-store/';
  const catalogObjectKey = R2_CAPABILITY_STORE_CATALOG_KEY();
  const packObjectKey = `${root}presets/${pid}.json`;
  const packBody = JSON.stringify([p], null, 2);
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET(),
      Key: packObjectKey,
      Body: Buffer.from(packBody, 'utf8'),
      ContentType: 'application/json; charset=utf-8',
    })
  );

  const existing = await getJsonObjectOrDefault(s3, catalogObjectKey, []);
  const currentCatalog = Array.isArray(existing) ? existing : [];
  const nextItem = {
    id: `preset_${pid}`,
    type: 'capability_presets',
    name: label || pid,
    desc: `管理员上传能力预设：${label || pid}`,
    version: String(now),
    url: `./presets/${pid}.json`,
    updatedAt: toYmd(now),
    tags: ['r2', 'admin-upload'],
  };
  const filtered = currentCatalog.filter((x) => {
    if (!x || typeof x !== 'object') return false;
    const id = String(x.id || '').trim();
    return id !== nextItem.id;
  });
  const nextCatalog = [nextItem, ...filtered];
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET(),
      Key: catalogObjectKey,
      Body: Buffer.from(JSON.stringify(nextCatalog, null, 2), 'utf8'),
      ContentType: 'application/json; charset=utf-8',
    })
  );
  return { catalogObjectKey, packObjectKey };
}

/** inject.embedded：挂在 auth 同源；inject.resolveSessionUserId：直接解析会话，避免再请求 AUTH_ME_URL */
export async function handleR2StorageRequest(req, res, inject = {}) {
  const embedded = !!inject.embedded;

  if (!embedded) {
    const corsOk = applyCors(req, res);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
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
  }

  const pathname = parsePathname(req.url);
  const parsedUrl = new URL(req.url || '/', 'http://localhost');

  const s3 = getS3();
  if (!s3) {
    sendJson(res, 503, { error: 'R2 未配置' });
    return;
  }

  try {
    if (pathname === '/healthz' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        service: 'r2-storage-api',
        bucket: R2_BUCKET(),
        userScope: R2_ENFORCE_USER_SCOPE(),
      });
      return;
    }

    const sessionUserId = await resolveSessionUserId(req, inject);

    if (pathname === '/api/r2/upload-url' && req.method === 'POST') {
      await handleCreateUploadUrl(req, res, sessionUserId, s3);
      return;
    }

    if (pathname === '/api/r2/register-upload' && req.method === 'POST') {
      await handleRegisterUpload(req, res, sessionUserId, s3);
      return;
    }

    if (pathname === '/api/r2/download-url' && req.method === 'POST') {
      await handleCreateDownloadUrl(req, res, sessionUserId, s3);
      return;
    }

    if (pathname === '/api/r2/objects' && req.method === 'GET') {
      await handleListObjects(req, res, parsedUrl, sessionUserId, s3);
      return;
    }

    if (pathname.startsWith('/api/r2/objects/')) {
      const objectKey = safeObjectKey(decodeURIComponent(pathname.slice('/api/r2/objects/'.length)));
      if (req.method === 'GET') {
        await handleHeadObject(req, res, objectKey, sessionUserId, s3);
        return;
      }
      if (req.method === 'DELETE') {
        await handleDeleteObject(req, res, objectKey, sessionUserId, s3);
        return;
      }
    }

    if (pathname === '/api/r2/capability-store/catalog' && req.method === 'GET') {
      await handleCapabilityStoreObject(req, res, R2_CAPABILITY_STORE_CATALOG_KEY(), s3);
      return;
    }

    if (pathname.startsWith('/api/r2/capability-store/') && req.method === 'GET') {
      const rel = safeRelativeObjectPath(pathname.slice('/api/r2/capability-store/'.length));
      const objectKey = `${catalogRootPrefix()}${rel}`;
      await handleCapabilityStoreObject(req, res, objectKey, s3);
      return;
    }

    sendJson(res, 404, {
      error: 'Not found. Use POST /api/r2/upload-url, POST /api/r2/download-url, GET /api/r2/objects, DELETE /api/r2/objects/:key',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { error: message });
  }
}

/** 管理端：扫描 R2 用户工作区前缀，重建「工作流图片」用量账本 */
export async function reconcileUserWorkspaceBillableUsage(userId, s3, bucket, options = {}) {
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('userId 无效');
  const prefix = `users/${uid}/workspace/`;
  const keyToSize = {};
  let token;
  for (;;) {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: token || undefined,
      })
    );
    for (const item of result.Contents || []) {
      const k = item.Key || '';
      if (!k) continue;
      if (!isBillableWorkspaceImageKey(uid, k)) continue;
      keyToSize[k] = Number(item.Size || 0);
    }
    if (result.IsTruncated && result.NextContinuationToken) token = result.NextContinuationToken;
    else break;
  }
  return replaceUserUsageFromScan(uid, keyToSize, options);
}

export function runWorkspaceUsageReconcileForUser(userId, options = {}) {
  assertR2Config();
  const s3 = getS3();
  const bucket = R2_BUCKET();
  if (!s3 || !bucket) throw new Error('R2 未配置');
  return reconcileUserWorkspaceBillableUsage(userId, s3, bucket, options);
}
