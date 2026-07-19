import crypto from 'crypto';
import { isR2Configured, putPublicR2Object } from '../r2-storage-handlers.js';

const MAX_ARCHIVE_BYTES = Number(process.env.AI_GATEWAY_MEDIA_ARCHIVE_MAX_BYTES || 25 * 1024 * 1024);
const REMOTE_MEDIA_TIMEOUT_MS = Number(process.env.AI_GATEWAY_REMOTE_MEDIA_ARCHIVE_TIMEOUT_MS || 60_000);
const MEDIA_URL_KEYS = new Set([
  'url',
  'imageUrl',
  'image_url',
  'videoUrl',
  'video_url',
  'downloadUrl',
  'download_url',
  'publicUrl',
  'public_url',
  'src',
]);

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

function mediaKindFromContext(key, owner) {
  const k = String(key || '').toLowerCase();
  const kind = String(owner?.kind || '').toLowerCase();
  const mime = String(owner?.mimeType || owner?.mime_type || owner?.contentType || owner?.content_type || '').toLowerCase();
  if (kind === 'video' || k.includes('video') || mime.startsWith('video/')) return 'video';
  if (kind === 'image' || k.includes('image') || k.includes('preview') || mime.startsWith('image/')) return 'image';
  if (kind === 'audio' || k.includes('audio') || mime.startsWith('audio/')) return 'audio';
  return '';
}

function isRemoteHttpUrl(value) {
  return /^https?:\/\//i.test(nonEmptyString(value));
}

function shouldArchiveRemoteUrl(key, value, owner) {
  if (!isRemoteHttpUrl(value)) return false;
  if (!MEDIA_URL_KEYS.has(String(key || ''))) return false;
  return Boolean(mediaKindFromContext(key, owner));
}

async function fetchRemoteMedia(value, key, owner) {
  const url = nonEmptyString(value);
  const expectedKind = mediaKindFromContext(key, owner);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_MEDIA_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { Range: `bytes=0-${Math.max(0, MAX_ARCHIVE_BYTES)}` },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!resp.ok && resp.status !== 206) return null;
    const contentType = String(resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (expectedKind === 'video' && !contentType.startsWith('video/')) return null;
    if (expectedKind === 'image' && !contentType.startsWith('image/')) return null;
    if (expectedKind === 'audio' && !contentType.startsWith('audio/')) return null;
    const contentRange = String(resp.headers.get('content-range') || '');
    const totalMatch = /\/(\d+)\s*$/.exec(contentRange);
    const contentLength = Number(resp.headers.get('content-length') || 0);
    const totalBytes = totalMatch ? Number(totalMatch[1]) : contentLength;
    if (Number.isFinite(totalBytes) && totalBytes > MAX_ARCHIVE_BYTES) return null;
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_ARCHIVE_BYTES) return null;
    return {
      buffer,
      bytes: buffer.length,
      mimeType: contentType || (expectedKind === 'video' ? 'video/mp4' : 'application/octet-stream'),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

function archiveKeyFor(plan, mimeType) {
  const userId = nonEmptyString(plan?.job?.userId) || 'anonymous';
  const jobId = nonEmptyString(plan?.job?.id) || `aijob_${crypto.randomUUID()}`;
  const ext = extFromMime(mimeType);
  return `public/ai-gateway-results/${encodeURIComponent(userId)}/${encodeURIComponent(jobId)}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
}

async function archiveDataUrl(plan, value) {
  const parsed = parseDataUrl(value);
  if (!parsed || !isR2Configured()) return null;
  const { publicUrl, objectKey } = await putPublicR2Object(archiveKeyFor(plan, parsed.mimeType), parsed.buffer, {
    contentType: parsed.mimeType,
  });
  if (!publicUrl) return null;
  return {
    url: publicUrl,
    objectKey,
    mimeType: parsed.mimeType,
    bytes: parsed.bytes,
    archived: true,
  };
}

async function archiveRemoteUrl(plan, value, key, owner) {
  if (!shouldArchiveRemoteUrl(key, value, owner) || !isR2Configured()) return null;
  const fetched = await fetchRemoteMedia(value, key, owner);
  if (!fetched) return null;
  const { publicUrl, objectKey } = await putPublicR2Object(archiveKeyFor(plan, fetched.mimeType), fetched.buffer, {
    contentType: fetched.mimeType,
  });
  if (!publicUrl) return null;
  return {
    url: publicUrl,
    objectKey,
    mimeType: fetched.mimeType,
    bytes: fetched.bytes,
    archived: true,
    originalUrl: nonEmptyString(value),
  };
}

async function replaceDataUrls(plan, value, depth = 0) {
  if (value == null || depth > 8) return value;
  if (typeof value === 'string') {
    const archived = await archiveDataUrl(plan, value);
    return archived?.url || value;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await replaceDataUrls(plan, item, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') {
      const archived = (await archiveDataUrl(plan, raw)) || (await archiveRemoteUrl(plan, raw, key, value));
      if (archived) {
        out[key] = archived.url;
        if (['url', 'dataUrl', 'imageUrl', 'image_url', 'videoUrl', 'video_url', 'previewUrl'].includes(key)) {
          out.url = archived.url;
          out.previewUrl = archived.url;
        }
        if (key === 'videoUrl' || key === 'video_url') out.videoUrl = archived.url;
        if (key === 'imageUrl' || key === 'image_url') out.imageUrl = archived.url;
        out.mimeType = out.mimeType || archived.mimeType;
        out.bytes = out.bytes || archived.bytes;
        out.r2Key = out.r2Key || archived.objectKey;
        out.inlineData = false;
        out.archived = true;
        if (archived.originalUrl) out.upstreamUrl = out.upstreamUrl || archived.originalUrl;
        continue;
      }
    }
    out[key] = await replaceDataUrls(plan, raw, depth + 1);
  }
  return out;
}

export async function archiveAiGatewayJobMedia(plan) {
  if (!plan?.job || !isR2Configured()) return plan;
  const job = { ...plan.job };
  if (job.output !== undefined) job.output = await replaceDataUrls(plan, job.output);
  if (Array.isArray(job.artifacts)) job.artifacts = await replaceDataUrls(plan, job.artifacts);
  return { ...plan, job };
}
