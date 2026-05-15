/**
 * Script Hub：revision 正文写入 Cloudflare R2（与现有 R2 环境变量一致）。
 * 键前缀固定 `script-hub/`，与规格 §5.2 对齐。
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

function normalizeSecret(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\uFEFF/g, '').replace(/\r\n?/g, '').trim();
}

const R2_ACCOUNT_ID = () => normalizeSecret(process.env.R2_ACCOUNT_ID || '');
const R2_ACCESS_KEY_ID = () => normalizeSecret(process.env.R2_ACCESS_KEY_ID || '');
const R2_SECRET_ACCESS_KEY = () => normalizeSecret(process.env.R2_SECRET_ACCESS_KEY || '');
const R2_BUCKET = () => normalizeSecret(process.env.R2_BUCKET || '');

let _s3 = null;

function getS3() {
  if (!scriptHubR2Enabled()) return null;
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

/** 与 r2-storage-handlers 一致：四元组齐全且未显式关闭 SCRIPT_HUB_USE_R2 */
export function scriptHubR2Enabled() {
  if (String(process.env.SCRIPT_HUB_USE_R2 || 'true').trim().toLowerCase() === 'false') return false;
  return !!(R2_ACCOUNT_ID() && R2_ACCESS_KEY_ID() && R2_SECRET_ACCESS_KEY() && R2_BUCKET());
}

function assertAllowedKey(key) {
  const k = String(key || '').trim();
  if (!k.startsWith('script-hub/')) throw new Error('script-hub R2 key 非法');
  if (k.includes('..')) throw new Error('script-hub R2 key 非法');
}

export function buildScriptRevisionObjectKey(ownerUserId, scriptId, version) {
  const v = Math.floor(Number(version));
  if (!Number.isFinite(v) || v < 1) throw new Error('version 非法');
  const uid = String(ownerUserId || '').trim();
  const sid = String(scriptId || '').trim();
  if (!uid || !sid) throw new Error('script-hub R2 key 参数非法');
  return `script-hub/${uid}/${sid}/rev-${v}.py`;
}

async function streamBodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === 'function') {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    body.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    body.on('error', reject);
    body.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export async function putScriptRevisionUtf8(objectKey, utf8Body) {
  assertAllowedKey(objectKey);
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET(),
      Key: objectKey,
      Body: Buffer.from(utf8Body, 'utf8'),
      ContentType: 'text/x-python; charset=utf-8',
    }),
  );
}

export async function getScriptRevisionUtf8(objectKey) {
  assertAllowedKey(objectKey);
  const s3 = getS3();
  if (!s3) throw new Error('R2 未配置');
  const got = await s3.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET(),
      Key: objectKey,
    }),
  );
  const buf = await streamBodyToBuffer(got.Body);
  return buf.toString('utf8');
}

export async function deleteScriptRevisionObjects(objectKeys) {
  if (!scriptHubR2Enabled()) return;
  const s3 = getS3();
  if (!s3) return;
  for (const raw of objectKeys) {
    const key = String(raw || '').trim();
    if (!key.startsWith('script-hub/')) continue;
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET(), Key: key }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[script-hub-r2] delete failed', key, msg);
    }
  }
}
