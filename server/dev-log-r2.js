/**
 * Dev log on R2 (not in Git). Shared by auth-api routes and post-push script.
 */
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const DEV_LOG_PREFIX = 'dev-log/';
const INDEX_KEY = `${DEV_LOG_PREFIX}index.json`;

function normalizeSecret(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\uFEFF/g, '').replace(/\r\n?/g, '').trim();
}

const R2_ACCOUNT_ID = () => normalizeSecret(process.env.R2_ACCOUNT_ID || '');
const R2_ACCESS_KEY_ID = () => normalizeSecret(process.env.R2_ACCESS_KEY_ID || '');
const R2_SECRET_ACCESS_KEY = () => normalizeSecret(process.env.R2_SECRET_ACCESS_KEY || '');
const R2_BUCKET = () => normalizeSecret(process.env.R2_BUCKET || '');

export function isDevLogR2Configured() {
  return !!(R2_ACCOUNT_ID() && R2_ACCESS_KEY_ID() && R2_SECRET_ACCESS_KEY() && R2_BUCKET());
}

let _s3 = null;
function getS3() {
  if (!isDevLogR2Configured()) return null;
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

async function getJsonOrNull(s3, key) {
  try {
    const got = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET(), Key: key }));
    const text = await streamBodyToString(got.Body);
    return JSON.parse(text || 'null');
  } catch (e) {
    const name = e && typeof e === 'object' && 'name' in e ? String(e.name) : '';
    const code = e && typeof e === 'object' && 'Code' in e ? String(e.Code) : '';
    const http = e && typeof e === 'object' && '$metadata' in e ? e.$metadata?.httpStatusCode : undefined;
    if (name === 'NoSuchKey' || code === 'NoSuchKey' || http === 404) return null;
    throw e;
  }
}

async function putJson(s3, key, obj) {
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET(),
      Key: key,
      Body: Buffer.from(JSON.stringify(obj, null, 2), 'utf8'),
      ContentType: 'application/json; charset=utf-8',
    })
  );
}

export function emptyDevLogIndex() {
  return {
    updatedAt: new Date().toISOString(),
    lastPushSha: '',
    days: [],
  };
}

export function entryObjectKey(dayKey, entryId) {
  return `${DEV_LOG_PREFIX}entries/${dayKey}/${entryId}.json`;
}

export async function readDevLogIndex() {
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const data = await getJsonOrNull(s3, INDEX_KEY);
  if (!data || typeof data !== 'object') return emptyDevLogIndex();
  return {
    updatedAt: String(data.updatedAt || ''),
    lastPushSha: String(data.lastPushSha || ''),
    days: Array.isArray(data.days) ? data.days : [],
  };
}

export async function readDevLogEntry(dayKey, entryId) {
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const dk = String(dayKey || '').trim();
  const id = String(entryId || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) throw new Error('dayKey 非法');
  if (!id || id.includes('..') || id.includes('/')) throw new Error('entryId 非法');
  return getJsonOrNull(s3, entryObjectKey(dk, id));
}

export async function readDevLogDayEntries(dayKey) {
  const index = await readDevLogIndex();
  const dk = String(dayKey || '').trim();
  const day = index.days.find((d) => d && d.dayKey === dk);
  const ids = Array.isArray(day?.entryIds) ? day.entryIds : [];
  const entries = [];
  for (const id of ids) {
    const e = await readDevLogEntry(dk, id);
    if (e) entries.push(e);
  }
  entries.sort((a, b) => String(b.pushedAt || '').localeCompare(String(a.pushedAt || '')));
  return entries;
}

/**
 * Upsert one push entry and refresh index.lastPushSha / days.
 */
export async function upsertDevLogEntry(entry) {
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const dayKey = String(entry?.dayKey || '').trim();
  const id = String(entry?.id || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new Error('dayKey 非法');
  if (!id || id.includes('..') || id.includes('/')) throw new Error('entryId 非法');

  const key = entryObjectKey(dayKey, id);
  await putJson(s3, key, entry);

  const index = await readDevLogIndex();
  let day = index.days.find((d) => d && d.dayKey === dayKey);
  if (!day) {
    day = { dayKey, entryIds: [] };
    index.days.push(day);
  }
  if (!Array.isArray(day.entryIds)) day.entryIds = [];
  if (!day.entryIds.includes(id)) day.entryIds.unshift(id);
  index.days.sort((a, b) => String(b.dayKey).localeCompare(String(a.dayKey)));
  index.lastPushSha = String(entry.toSha || index.lastPushSha || '');
  index.updatedAt = new Date().toISOString();
  await putJson(s3, INDEX_KEY, index);
  return { key, index };
}

export async function putDevLogReceiptPng(dayKey, pngBuffer) {
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const dk = String(dayKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) throw new Error('dayKey 非法');
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0) throw new Error('空图片');
  const key = `${DEV_LOG_PREFIX}receipts/${dk}.png`;
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET(),
      Key: key,
      Body: pngBuffer,
      ContentType: 'image/png',
    })
  );
  return { key };
}
