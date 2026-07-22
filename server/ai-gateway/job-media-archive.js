import crypto from 'crypto';
import { isR2Configured, putPublicR2Object } from '../r2-storage-handlers.js';

const MAX_ARCHIVE_BYTES = Number(process.env.AI_GATEWAY_MEDIA_ARCHIVE_MAX_BYTES || 25 * 1024 * 1024);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function extFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('video/mp4')) return 'mp4';
  if (mime.includes('png')) return 'png';
  return 'bin';
}

function parseDataUrl(value) {
  const text = nonEmptyString(value);
  const match = /^data:([^;,]+);base64,(.+)$/is.exec(text);
  if (!match) return null;
  const mimeType = match[1].trim() || 'application/octet-stream';
  const b64 = match[2].replace(/\s/g, '');
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length || buffer.length > MAX_ARCHIVE_BYTES) return null;
  return { mimeType, buffer, bytes: buffer.length };
}

function looksLikeBareBase64Media(value) {
  const text = nonEmptyString(value).replace(/\s/g, '');
  if (text.length < 8000) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
  try {
    const buffer = Buffer.from(text, 'base64');
    return buffer.length > 0 && buffer.length <= MAX_ARCHIVE_BYTES;
  } catch {
    return false;
  }
}

function parseInlineMedia(value) {
  const dataUrl = parseDataUrl(value);
  if (dataUrl) return dataUrl;
  const text = nonEmptyString(value).replace(/\s/g, '');
  if (!looksLikeBareBase64Media(text)) return null;
  const buffer = Buffer.from(text, 'base64');
  return { mimeType: 'image/png', buffer, bytes: buffer.length };
}

function archiveKeyFor(plan, mimeType) {
  const userId = nonEmptyString(plan?.job?.userId) || 'anonymous';
  const jobId = nonEmptyString(plan?.job?.id) || `aijob_${crypto.randomUUID()}`;
  const ext = extFromMime(mimeType);
  return `public/ai-gateway-results/${encodeURIComponent(userId)}/${encodeURIComponent(jobId)}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
}

async function archiveInlineMedia(plan, value, archiveCache) {
  const parsed = parseInlineMedia(value);
  if (!parsed || !isR2Configured()) return null;
  const cacheKey = nonEmptyString(value).replace(/\s/g, '');
  if (archiveCache?.has(cacheKey)) return archiveCache.get(cacheKey);
  const { publicUrl, objectKey } = await putPublicR2Object(archiveKeyFor(plan, parsed.mimeType), parsed.buffer, {
    contentType: parsed.mimeType,
  });
  if (!publicUrl) return null;
  const archived = {
    url: publicUrl,
    objectKey,
    mimeType: parsed.mimeType,
    bytes: parsed.bytes,
    archived: true,
  };
  if (archiveCache && cacheKey) archiveCache.set(cacheKey, archived);
  return archived;
}

async function replaceDataUrls(plan, value, depth = 0, archiveCache = new Map()) {
  if (value == null || depth > 8) return value;
  if (typeof value === 'string') {
    const archived = await archiveInlineMedia(plan, value, archiveCache);
    return archived?.url || value;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await replaceDataUrls(plan, item, depth + 1, archiveCache));
    return out;
  }
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') {
      const archived = await archiveInlineMedia(plan, raw, archiveCache);
      if (archived) {
        out[key] = archived.url;
        if (['url', 'dataUrl', 'imageUrl', 'previewUrl'].includes(key)) {
          out.url = archived.url;
          out.previewUrl = archived.url;
        }
        out.mimeType = out.mimeType || archived.mimeType;
        out.bytes = out.bytes || archived.bytes;
        out.r2Key = out.r2Key || archived.objectKey;
        out.inlineData = false;
        out.archived = true;
        continue;
      }
    }
    out[key] = await replaceDataUrls(plan, raw, depth + 1, archiveCache);
  }
  return out;
}

export async function archiveAiGatewayJobMedia(plan) {
  if (!plan?.job || !isR2Configured()) return plan;
  const job = { ...plan.job };
  const archiveCache = new Map();
  if (job.output !== undefined) job.output = await replaceDataUrls(plan, job.output, 0, archiveCache);
  if (Array.isArray(job.artifacts)) job.artifacts = await replaceDataUrls(plan, job.artifacts, 0, archiveCache);
  return { ...plan, job };
}
