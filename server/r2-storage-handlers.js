import { S3Client, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { findUserById, getWorkspaceQuotaBytesForUser } from './auth-store.js';
import {
  CAPABILITY_PRESET_BACKUP_FORMAT,
  buildImportPlan,
  extractPresetIdFromCatalogItem,
} from './capability-preset-admin-import.js';
import {
  getTrackedBytesForKey,
  getWorkspaceUsedBytes,
  isBillableWorkspaceImageKey,
  registerBillableObjectAfterPut,
  replaceUserUsageFromScan,
  unregisterBillableObjectAfterDelete,
} from './workspace-storage-usage.js';
import { applyWorkspaceObjectRefDelta } from './workspace-object-refs.js';
import {
  API_JSON_BODY_MAX_BYTES,
  BODY_TOO_LARGE_MESSAGE,
  R2_CAPABILITY_PREVIEW_MAX_BYTES,
  readBodyUtf8,
} from './http-limits.js';
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

async function streamBodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === 'function') {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }
  if (typeof body.transformToString === 'function') {
    const text = await body.transformToString('utf-8');
    return Buffer.from(text, 'utf8');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    body.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    body.on('error', reject);
    body.on('end', () => resolve(Buffer.concat(chunks)));
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

/** 管理端读取能力商店 catalog（R2 JSON 数组） */
export async function readCapabilityStoreCatalog() {
  if (!isR2Configured()) return [];
  const s3 = getS3();
  if (!s3) return [];
  const catalogObjectKey = R2_CAPABILITY_STORE_CATALOG_KEY();
  const existing = await getJsonObjectOrDefault(s3, catalogObjectKey, []);
  return Array.isArray(existing) ? existing : [];
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

async function readBody(req, maxBytes = API_JSON_BODY_MAX_BYTES) {
  return readBodyUtf8(req, maxBytes);
}

function sanitizeUserPathSegment(s) {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function userStorageDirName(userId, username) {
  const uid = String(userId || '').trim();
  const name = sanitizeUserPathSegment(username || '');
  return name ? `${name}-${uid}` : uid;
}

async function resolveSessionUserFetch(req) {
  if (!R2_ENFORCE_USER_SCOPE()) return null;
  const cookie = String(req.headers.cookie || '');
  if (!cookie) return null;
  try {
    const r = await fetch(AUTH_ME_URL(), { headers: { cookie } });
    if (!r.ok) return null;
    const data = await r.json();
    const id = data?.user?.id;
    const username = data?.user?.username;
    if (typeof id !== 'string' || !id) return null;
    return {
      id,
      username: typeof username === 'string' && username.trim() ? username.trim() : null,
    };
  } catch {
    return null;
  }
}

async function resolveSessionUser(req, inject) {
  if (!R2_ENFORCE_USER_SCOPE()) return null;
  if (inject?.resolveSessionUser) {
    const u = await inject.resolveSessionUser(req);
    const id = u?.id;
    const username = u?.username;
    if (typeof id !== 'string' || !id) return null;
    return {
      id,
      username: typeof username === 'string' && username.trim() ? username.trim() : null,
    };
  }
  if (inject?.resolveSessionUserId) {
    const id = await inject.resolveSessionUserId(req);
    return id ? { id, username: null } : null;
  }
  return resolveSessionUserFetch(req);
}

function userRootPrefix(userId, username) {
  return `users/${userStorageDirName(userId, username)}/`;
}

function extractUserSegmentFromKey(objectKey) {
  const key = String(objectKey || '').trim().replace(/^\/+/, '');
  if (!key.startsWith('users/')) return '';
  return key.slice('users/'.length).split('/')[0] || '';
}

function isUserScopedObjectKey(sessionUser, objectKey) {
  if (!sessionUser?.id) return false;
  const seg = extractUserSegmentFromKey(objectKey);
  if (!seg) return false;
  return seg.endsWith(`-${sessionUser.id}`);
}

function isUserScopedPrefix(sessionUser, prefixRaw) {
  if (!sessionUser?.id) return false;
  const p = String(prefixRaw || '').trim().replace(/^\/+/, '');
  if (!p.startsWith('users/')) return false;
  const seg = p.slice('users/'.length).split('/')[0] || '';
  return !!seg && seg.endsWith(`-${sessionUser.id}`);
}

function isWorkspaceWorkflowJsonKey(objectKey) {
  const key = String(objectKey || '').trim().replace(/^\/+/, '');
  return /\/workspace\/projects\/[^/]+\/workflow\.json$/i.test(key);
}

async function readS3BodyUtf8WithLimit(body, maxBytes) {
  if (!body) return '';
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error('工作流文件过大，无法校验能力作用域');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function assertWorkflowJsonHasNoAccountCapabilities(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawText || ''));
  } catch {
    throw new Error('workflow.json 不是合法 JSON');
  }
  if (!parsed || typeof parsed !== 'object') return;
  const root = parsed;
  if (Object.prototype.hasOwnProperty.call(root, 'capabilityPresets')) {
    const e = new Error('项目级 workflow.json 禁止携带 capabilityPresets（能力为账号级资产）');
    e.code = 'PROJECT_CAPABILITY_SCOPE_VIOLATION';
    throw e;
  }
  if (Object.prototype.hasOwnProperty.call(root, 'capabilitySets')) {
    const e = new Error('项目级 workflow.json 禁止携带 capabilitySets（能力为账号级资产）');
    e.code = 'PROJECT_CAPABILITY_SCOPE_VIOLATION';
    throw e;
  }
}

function assertUserObjectKey(sessionUser, objectKey) {
  if (!R2_ENFORCE_USER_SCOPE()) return;
  if (!sessionUser?.id) throw new Error('未登录');
  if (!isUserScopedObjectKey(sessionUser, objectKey)) throw new Error('无权访问该对象路径');
}

function resolveListPrefix(sessionUser, prefixRaw) {
  if (!R2_ENFORCE_USER_SCOPE()) return String(prefixRaw || '');
  if (!sessionUser?.id) throw new Error('未登录');
  const root = userRootPrefix(sessionUser.id, sessionUser.username);
  let p = String(prefixRaw || '').trim().replace(/^\/+/, '');
  if (!p) return root;
  if (!isUserScopedPrefix(sessionUser, p)) throw new Error('列举路径必须在当前用户命名空间下');
  return p;
}

async function handleCreateUploadUrl(req, res, sessionUser, s3) {
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
    assertUserObjectKey(sessionUser, objectKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, msg === '未登录' ? 401 : 403, { error: msg });
    return;
  }
  const billable = !!(sessionUser?.id && isBillableWorkspaceImageKey(sessionUser.id, objectKey));
  if (billable) {
    const declared = Math.floor(Number(body.contentLength));
    if (!Number.isFinite(declared) || declared < 1) {
      sendJson(res, 400, { error: '上传工作区图片必须提供 contentLength（字节）', code: 'CONTENT_LENGTH_REQUIRED' });
      return;
    }
    const dbUser = await findUserById(sessionUser.id);
    if (!dbUser) {
      sendJson(res, 401, { error: '用户不存在' });
      return;
    }
    const quota = getWorkspaceQuotaBytesForUser(dbUser);
    const used = getWorkspaceUsedBytes(sessionUser.id);
    const oldTracked = getTrackedBytesForKey(sessionUser.id, objectKey);
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

async function handleCreateDownloadUrl(req, res, sessionUser, s3) {
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
    assertUserObjectKey(sessionUser, objectKey);
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

async function handleRegisterUpload(req, res, sessionUser, s3) {
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
    assertUserObjectKey(sessionUser, objectKey);
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
  if (isWorkspaceWorkflowJsonKey(objectKey)) {
    try {
      const getResp = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: objectKey,
        })
      );
      const text = await readS3BodyUtf8WithLimit(getResp.Body, 5 * 1024 * 1024);
      assertWorkflowJsonHasNoAccountCapabilities(text);
    } catch (e) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
      } catch {
        /* ignore */
      }
      const code = e && typeof e === 'object' && 'code' in e ? e.code : undefined;
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 400, {
        error: msg || 'workflow.json 校验失败',
        code: code || 'WORKFLOW_JSON_VALIDATION_FAILED',
      });
      return;
    }
  }
  if (!isBillableWorkspaceImageKey(sessionUser?.id, objectKey)) {
    sendJson(res, 200, {
      ok: true,
      billable: false,
      usedBytes: getWorkspaceUsedBytes(sessionUser?.id),
    });
    return;
  }
  const dbUser = await findUserById(sessionUser.id);
  if (!dbUser) {
    sendJson(res, 401, { error: '用户不存在' });
    return;
  }
  const quota = getWorkspaceQuotaBytesForUser(dbUser);
  const used = getWorkspaceUsedBytes(sessionUser.id);
  const oldTracked = getTrackedBytesForKey(sessionUser.id, objectKey);
  if (used - oldTracked + headSize > quota) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    } catch {
      /* ignore */
    }
    sendJson(res, 403, {
      error: '上传后超出工作区云配额，已丢弃该对象。',
      code: 'STORAGE_QUOTA_EXCEEDED',
      usedBytes: getWorkspaceUsedBytes(sessionUser.id),
      quotaBytes: quota,
    });
    return;
  }
  const { ok, usedBytes } = registerBillableObjectAfterPut(sessionUser.id, objectKey, headSize);
  if (!ok) {
    sendJson(res, 400, { error: '登记用量失败' });
    return;
  }
  sendJson(res, 200, { ok: true, billable: true, usedBytes, quotaBytes: quota });
}

async function handleListObjects(req, res, parsedUrl, sessionUser, s3) {
  let prefix;
  try {
    prefix = resolveListPrefix(sessionUser, parsedUrl.searchParams.get('prefix') || '');
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

async function handleHeadObject(req, res, objectKey, sessionUser, s3) {
  try {
    assertUserObjectKey(sessionUser, objectKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, msg === '未登录' ? 401 : 403, { error: msg });
    return;
  }
  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: R2_BUCKET(),
        Key: objectKey,
      })
    );
  } catch (e) {
    const status = Number(e?.$metadata?.httpStatusCode || 0);
    const name = String(e?.name || '');
    const msg = String(e?.message || '');
    const notFound = status === 404 || name === 'NotFound' || msg.toLowerCase().includes('not found');
    if (notFound) {
      sendJson(res, 404, { error: '对象不存在' });
      return;
    }
    throw e;
  }
  sendJson(res, 200, { ok: true, objectKey });
}

async function handleDeleteObject(req, res, objectKey, sessionUser, s3) {
  try {
    assertUserObjectKey(sessionUser, objectKey);
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
  const { usedBytes } = unregisterBillableObjectAfterDelete(sessionUser?.id, objectKey, headSize);
  sendJson(res, 200, { ok: true, objectKey, usedBytes });
}

async function handleReconcileObjectRefs(req, res, sessionUser, s3) {
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
  const addKeysRaw = Array.isArray(body.addKeys) ? body.addKeys : [];
  const removeKeysRaw = Array.isArray(body.removeKeys) ? body.removeKeys : [];
  const addKeys = addKeysRaw.map((k) => safeObjectKey(k));
  const removeKeys = removeKeysRaw.map((k) => safeObjectKey(k));
  for (const k of addKeys) assertUserObjectKey(sessionUser, k);
  for (const k of removeKeys) assertUserObjectKey(sessionUser, k);
  const { deletedKeys } = applyWorkspaceObjectRefDelta(sessionUser.id, addKeys, removeKeys);
  for (const key of deletedKeys) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET(), Key: key }));
    } catch {
      /* ignore */
    }
    unregisterBillableObjectAfterDelete(sessionUser.id, key, 0);
  }
  sendJson(res, 200, { ok: true, deletedKeys });
}


function extFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'png';
}

function parseDataUrlImage(dataUrl) {
  const s = String(dataUrl || '').trim();
  const m = /^data:([^;]+);base64,(.+)$/is.exec(s);
  if (!m) return null;
  const mime = m[1].trim();
  const b64 = m[2].replace(/\s/g, '');
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length || buffer.length > R2_CAPABILITY_PREVIEW_MAX_BYTES) return null;
  return { mime: mime || 'image/png', buffer };
}

async function handleCapabilityStoreObject(req, res, objectKey, s3) {
  const got = await s3.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET(),
      Key: objectKey,
    })
  );
  const contentType = String(got.ContentType || '').toLowerCase();
  const isJson = contentType.includes('application/json') || objectKey.endsWith('.json');
  if (isJson) {
    const text = await streamBodyToString(got.Body);
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
  const bin = await streamBodyToBuffer(got.Body);
  res.writeHead(200, {
    'Content-Type': got.ContentType || 'application/octet-stream',
    'Content-Length': String(bin.length),
  });
  res.end(bin);
}

const CAPABILITY_PRESET_PREVIEW_FIELDS = [
  'previewImage',
  'previewOriginalImage',
  'previewGeneratedImage',
  'previewOriginalThumbImage',
  'previewGeneratedThumbImage',
];

function resolveCatalogRelativeObjectKey(relPath) {
  const root = catalogRootPrefix() || 'public/capability-store/';
  const rel = String(relPath || '')
    .trim()
    .replace(/^\.\//, '');
  if (!rel || rel.includes('..')) throw new Error('catalog 相对路径非法');
  return `${root}${rel}`;
}

function collectPreviewObjectKeysFromPreset(preset, root = catalogRootPrefix() || 'public/capability-store/') {
  const keys = new Set();
  if (!preset || typeof preset !== 'object') return [];
  for (const fieldName of CAPABILITY_PRESET_PREVIEW_FIELDS) {
    const raw = preset[fieldName];
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (!text.startsWith('./')) continue;
    keys.add(`${root}${text.slice(2)}`);
  }
  return Array.from(keys);
}

async function preparePresetForR2Pack(s3, preset) {
  const p = preset && typeof preset === 'object' ? preset : null;
  if (!p) throw new Error('preset 无效');
  const pid = String(p.id || '').trim();
  const label = String(p.label || '').trim();
  if (!pid || !label) throw new Error('preset 缺少 id 或 label');
  const root = catalogRootPrefix() || 'public/capability-store/';
  const presetForPack = { ...p };
  const rawPreviewText = typeof presetForPack.previewImage === 'string' ? presetForPack.previewImage.trim() : '';
  const rawGeneratedText =
    typeof presetForPack.previewGeneratedImage === 'string' ? presetForPack.previewGeneratedImage.trim() : '';
  if (rawPreviewText && rawGeneratedText && rawPreviewText === rawGeneratedText && rawPreviewText.startsWith('data:')) {
    delete presetForPack.previewImage;
  }
  const normalizePreviewFieldRef = (fieldName) => {
    const raw = presetForPack[fieldName];
    if (typeof raw !== 'string') return;
    const text = raw.trim();
    if (!text || text.startsWith('data:') || text.startsWith('./')) return;
    try {
      const m = text.match(/^https?:\/\/[^/]+\/api\/r2\/capability-store\/(.+)$/i);
      if (m?.[1]) {
        const rel = String(m[1]).replace(/^\/+/, '');
        presetForPack[fieldName] = `./${rel}`;
      }
    } catch {
      // ignore malformed url
    }
  };
  for (const fieldName of CAPABILITY_PRESET_PREVIEW_FIELDS) normalizePreviewFieldRef(fieldName);
  const uploadPreviewField = async (fieldName, suffix = '') => {
    const raw = presetForPack[fieldName];
    if (typeof raw !== 'string') return;
    const text = raw.trim();
    if (!text.startsWith('data:')) return;
    const parsed = parseDataUrlImage(text);
    if (!parsed) {
      delete presetForPack[fieldName];
      return;
    }
    const ext = extFromMime(parsed.mime);
    const keyName = `${pid}${suffix ? `-${suffix}` : ''}.${ext}`;
    const previewRel = `./previews/${keyName}`;
    const previewObjectKey = `${root}previews/${keyName}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET(),
        Key: previewObjectKey,
        Body: parsed.buffer,
        ContentType: parsed.mime,
      })
    );
    presetForPack[fieldName] = previewRel;
  };
  await uploadPreviewField('previewImage');
  await uploadPreviewField('previewOriginalImage', 'orig');
  await uploadPreviewField('previewGeneratedImage', 'gen');
  await uploadPreviewField('previewOriginalThumbImage', 'orig-sm');
  await uploadPreviewField('previewGeneratedThumbImage', 'gen-sm');
  if (!presetForPack.previewImage && typeof presetForPack.previewGeneratedImage === 'string') {
    presetForPack.previewImage = presetForPack.previewGeneratedImage;
  }
  return { pid, label, presetForPack, root };
}

function buildDefaultCatalogItemFromPreset(presetForPack, catalogItemOverride) {
  const pid = String(presetForPack.id || '').trim();
  const label = String(presetForPack.label || '').trim();
  const now = Date.now();
  if (catalogItemOverride && typeof catalogItemOverride === 'object') {
    return {
      ...catalogItemOverride,
      id: String(catalogItemOverride.id || `preset_${pid}`).trim() || `preset_${pid}`,
      type: catalogItemOverride.type || 'capability_presets',
      url: `./presets/${pid}.json`,
      ...(typeof presetForPack.previewImage === 'string' && presetForPack.previewImage.trim().startsWith('./')
        ? { previewUrl: presetForPack.previewImage }
        : {}),
    };
  }
  return {
    id: `preset_${pid}`,
    type: 'capability_presets',
    name: label || pid,
    desc: `管理员上传能力预设：${label || pid}`,
    version: String(now),
    url: `./presets/${pid}.json`,
    updatedAt: toYmd(now),
    tags: ['r2', 'admin-upload'],
    ...(typeof presetForPack.previewImage === 'string' && presetForPack.previewImage.trim().startsWith('./')
      ? { previewUrl: presetForPack.previewImage }
      : {}),
  };
}

async function writePresetPackToR2(s3, presetForPack) {
  const pid = String(presetForPack.id || '').trim();
  const root = catalogRootPrefix() || 'public/capability-store/';
  const packObjectKey = `${root}presets/${pid}.json`;
  const packBody = JSON.stringify([presetForPack], null, 2);
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET(),
      Key: packObjectKey,
      Body: Buffer.from(packBody, 'utf8'),
      ContentType: 'application/json; charset=utf-8',
    })
  );
  return { packObjectKey };
}

async function writeCapabilityStoreCatalog(s3, catalogArray) {
  const catalogObjectKey = R2_CAPABILITY_STORE_CATALOG_KEY();
  const nextCatalog = Array.isArray(catalogArray) ? catalogArray : [];
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET(),
      Key: catalogObjectKey,
      Body: Buffer.from(JSON.stringify(nextCatalog, null, 2), 'utf8'),
      ContentType: 'application/json; charset=utf-8',
    })
  );
  return { catalogObjectKey, count: nextCatalog.length };
}

async function readPresetPackForCatalogItem(s3, item) {
  const url = String(item?.url || '').trim();
  if (!url) return null;
  const objectKey = resolveCatalogRelativeObjectKey(url);
  const data = await getJsonObjectOrDefault(s3, objectKey, null);
  if (!Array.isArray(data)) return null;
  return data;
}

export async function publishCapabilityPresetToR2Catalog(adminUserId, preset) {
  const uid = String(adminUserId || '').trim();
  if (!uid) throw new Error('管理员身份无效');
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const { pid, presetForPack } = await preparePresetForR2Pack(s3, preset);
  const { packObjectKey } = await writePresetPackToR2(s3, presetForPack);
  const catalogObjectKey = R2_CAPABILITY_STORE_CATALOG_KEY();
  const existing = await getJsonObjectOrDefault(s3, catalogObjectKey, []);
  const currentCatalog = Array.isArray(existing) ? existing : [];
  const nextItem = buildDefaultCatalogItemFromPreset(presetForPack);
  const filtered = currentCatalog.filter((x) => {
    if (!x || typeof x !== 'object') return false;
    const id = String(x.id || '').trim();
    return id !== nextItem.id;
  });
  const nextCatalog = [nextItem, ...filtered];
  await writeCapabilityStoreCatalog(s3, nextCatalog);
  return { catalogObjectKey, packObjectKey, presetId: pid };
}

export async function deleteCapabilityPresetFromR2Catalog(presetId, options = {}) {
  const pid = String(presetId || '').trim();
  if (!pid) throw new Error('presetId 无效');
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const root = catalogRootPrefix() || 'public/capability-store/';
  const catalogObjectKey = R2_CAPABILITY_STORE_CATALOG_KEY();
  const catalogId = `preset_${pid}`;
  const existing = await getJsonObjectOrDefault(s3, catalogObjectKey, []);
  const currentCatalog = Array.isArray(existing) ? existing : [];
  const targetItem = currentCatalog.find((x) => {
    if (!x || typeof x !== 'object') return false;
    if (String(x.id || '').trim() === catalogId) return true;
    return extractPresetIdFromCatalogItem(x) === pid;
  });
  const deletedKeys = [];
  let presetForDelete = null;
  try {
    const pack = targetItem ? await readPresetPackForCatalogItem(s3, targetItem) : null;
    presetForDelete = Array.isArray(pack) ? pack[0] : null;
  } catch {
    presetForDelete = null;
  }
  if (!presetForDelete) {
    try {
      const fallback = await getJsonObjectOrDefault(s3, `${root}presets/${pid}.json`, null);
      presetForDelete = Array.isArray(fallback) ? fallback[0] : null;
    } catch {
      presetForDelete = null;
    }
  }
  for (const key of collectPreviewObjectKeysFromPreset(presetForDelete, root)) {
    await deleteR2ObjectByKey(key);
    deletedKeys.push(key);
  }
  const packObjectKey = `${root}presets/${pid}.json`;
  try {
    await deleteR2ObjectByKey(packObjectKey);
    deletedKeys.push(packObjectKey);
  } catch {
    // pack may already be missing
  }
  if (targetItem?.previewUrl && String(targetItem.previewUrl).trim().startsWith('./')) {
    const previewKey = resolveCatalogRelativeObjectKey(targetItem.previewUrl);
    if (!deletedKeys.includes(previewKey)) {
      try {
        await deleteR2ObjectByKey(previewKey);
        deletedKeys.push(previewKey);
      } catch {
        // ignore missing preview
      }
    }
  }
  if (!options.skipCatalogWrite) {
    const nextCatalog = currentCatalog.filter((x) => {
      if (!x || typeof x !== 'object') return false;
      if (String(x.id || '').trim() === catalogId) return false;
      return extractPresetIdFromCatalogItem(x) !== pid;
    });
    await writeCapabilityStoreCatalog(s3, nextCatalog);
  }
  return { presetId: pid, catalogObjectKey, deletedKeys, removedFromCatalog: !!targetItem };
}

export async function exportCapabilityStoreBackup() {
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const catalog = await readCapabilityStoreCatalog();
  const presets = {};
  const missingPresetIds = [];
  for (const item of catalog) {
    const pid = extractPresetIdFromCatalogItem(item);
    if (!pid) {
      missingPresetIds.push(String(item?.id || '(unknown)'));
      continue;
    }
    const pack = await readPresetPackForCatalogItem(s3, item);
    if (pack) presets[pid] = pack;
    else missingPresetIds.push(pid);
  }
  if (missingPresetIds.length > 0) {
    throw new Error(`备份不完整：以下 catalog 项缺少 preset 包：${missingPresetIds.join(', ')}`);
  }
  return {
    format: CAPABILITY_PRESET_BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    catalogObjectKey: R2_CAPABILITY_STORE_CATALOG_KEY(),
    catalog,
    presets,
  };
}

export async function importCapabilityStoreBackup(adminUserId, backup, mode) {
  const uid = String(adminUserId || '').trim();
  if (!uid) throw new Error('管理员身份无效');
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const onlineCatalog = await readCapabilityStoreCatalog();
  const plan = buildImportPlan(onlineCatalog, backup, mode);
  // 先写入/更新 preset 包，再更新 catalog，最后删除孤儿对象，避免中途失败导致「包已删 catalog 仍在」
  for (const row of plan.presetsToWrite) {
    const { presetForPack } = await preparePresetForR2Pack(s3, row.preset);
    await writePresetPackToR2(s3, presetForPack);
  }
  const { catalogObjectKey, count } = await writeCapabilityStoreCatalog(s3, plan.catalog);
  for (const pid of plan.presetIdsToDelete) {
    await deleteCapabilityPresetFromR2Catalog(pid, { skipCatalogWrite: true });
  }
  return {
    mode: plan.mode,
    catalogObjectKey,
    finalCatalogCount: count,
    added: plan.added,
    updated: plan.updated,
    removed: plan.removed,
    unchanged: plan.unchanged,
    conflicts: plan.conflicts,
    writtenCount: plan.presetsToWrite.length,
    deletedCount: plan.presetIdsToDelete.length,
  };
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

    const sessionUser = await resolveSessionUser(req, inject);

    if (pathname === '/api/r2/upload-url' && req.method === 'POST') {
      await handleCreateUploadUrl(req, res, sessionUser, s3);
      return;
    }

    if (pathname === '/api/r2/register-upload' && req.method === 'POST') {
      await handleRegisterUpload(req, res, sessionUser, s3);
      return;
    }

    if (pathname === '/api/r2/download-url' && req.method === 'POST') {
      await handleCreateDownloadUrl(req, res, sessionUser, s3);
      return;
    }

    if (pathname === '/api/r2/objects' && req.method === 'GET') {
      await handleListObjects(req, res, parsedUrl, sessionUser, s3);
      return;
    }

    if (pathname === '/api/r2/object-refs/reconcile' && req.method === 'POST') {
      await handleReconcileObjectRefs(req, res, sessionUser, s3);
      return;
    }

    if (pathname.startsWith('/api/r2/objects/')) {
      const objectKey = safeObjectKey(decodeURIComponent(pathname.slice('/api/r2/objects/'.length)));
      if (req.method === 'GET') {
        await handleHeadObject(req, res, objectKey, sessionUser, s3);
        return;
      }
      if (req.method === 'DELETE') {
        await handleDeleteObject(req, res, objectKey, sessionUser, s3);
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
    if (message === BODY_TOO_LARGE_MESSAGE) {
      sendJson(res, 413, { error: message });
      return;
    }
    sendJson(res, 400, { error: message });
  }
}

/** 管理端：扫描 R2 用户工作区前缀，重建「工作流图片」用量账本 */
export async function reconcileUserWorkspaceBillableUsage(userId, s3, bucket, options = {}) {
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('userId 无效');
  const dbUser = await findUserById(uid);
  const prefix = `users/${userStorageDirName(uid, dbUser?.username)}/workspace/`;
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

/** 本地伴侣安装包 / 宿主插件包等发行物，与按用户作用域的 workspace 对象隔离 */
export const COMPANION_DISTRIBUTION_PREFIX = 'public/companion-distribution/';

export function assertCompanionDistributionObjectKey(objectKey) {
  const k = String(objectKey || '').trim().replace(/^\/+/, '');
  if (!k.startsWith(COMPANION_DISTRIBUTION_PREFIX)) {
    throw new Error(`对象键须以 ${COMPANION_DISTRIBUTION_PREFIX} 开头`);
  }
  if (k.includes('..')) throw new Error('objectKey 非法');
  return k;
}

/**
 * 管理端直传 R2（不走用户命名空间）。仅用于已登录管理员预签名 PUT。
 */
export async function presignPutCompanionDistribution({ objectKey, contentType, expiresIn }) {
  assertR2Config();
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const k = assertCompanionDistributionObjectKey(objectKey);
  const ct = String(contentType || 'application/octet-stream').trim() || 'application/octet-stream';
  const exp = Math.min(Math.max(60, Math.floor(Number(expiresIn) || 600)), 3600);
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET(),
    Key: k,
    ContentType: ct,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: exp });
  return { objectKey: k, contentType: ct, expiresIn: exp, uploadUrl };
}

/**
 * 任意键预签名 GET（仅服务端在核对 companion-artifacts 白名单后调用，勿对前端暴露任意 key）。
 */
export async function presignGetByKey(objectKey, expiresIn = 600) {
  assertR2Config();
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const k = safeObjectKey(objectKey);
  const exp = Math.min(Math.max(60, Math.floor(Number(expiresIn) || 600)), 3600);
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET(),
    Key: k,
  });
  const downloadUrl = await getSignedUrl(s3, command, { expiresIn: exp });
  return { objectKey: k, expiresIn: exp, downloadUrl };
}

/** 管理端删除发行记录时同步删除对象（与 companion-artifacts 元数据一致） */
export async function deleteR2ObjectByKey(objectKey) {
  assertR2Config();
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const k = safeObjectKey(objectKey);
  await s3.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET(),
      Key: k,
    }),
  );
  return { ok: true, objectKey: k };
}
