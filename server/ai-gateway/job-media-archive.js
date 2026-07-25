import crypto from 'crypto';
import { fetch as undiciFetch } from 'undici';
import { isR2Configured, putPublicR2Object, publicR2UrlForKey } from '../r2-storage-handlers.js';

const MAX_ARCHIVE_BYTES = Number(process.env.AI_GATEWAY_MEDIA_ARCHIVE_MAX_BYTES || 25 * 1024 * 1024);
const REMOTE_FETCH_TIMEOUT_MS = Number(process.env.AI_GATEWAY_MEDIA_ARCHIVE_FETCH_TIMEOUT_MS || 45_000);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isTruthyEnv(name) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function extFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('video/mp4')) return 'mp4';
  if (mime.includes('model') || mime.includes('gltf') || mime.includes('glb')) return 'glb';
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

function looksLikeVideoUrl(url, kindHint) {
  const kind = String(kindHint || '').toLowerCase();
  if (kind === 'video') return true;
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) || /\/video\//i.test(url);
}

function looksLikeImageUrl(url, kindHint, fieldKey) {
  const kind = String(kindHint || '').toLowerCase();
  if (kind === 'image') return true;
  if (kind === 'video' || kind === 'model3d') return false;
  const key = String(fieldKey || '').toLowerCase();
  if (/(^images?$|imageurl|preview|thumbnail|poster|cover|rendered)/i.test(key)) return true;
  return /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(url);
}

function isAlreadyOurR2Url(url) {
  const text = nonEmptyString(url);
  if (!text) return false;
  if (text.includes('/public/ai-gateway-results/')) return true;
  const sample = publicR2UrlForKey('public/ai-gateway-results/_probe');
  if (!sample) return false;
  try {
    const base = new URL(sample);
    const target = new URL(text);
    return base.host === target.host && target.pathname.includes('/public/ai-gateway-results/');
  } catch {
    return false;
  }
}

/** C14 health / ops snapshot */
export function aiGatewayMediaArchivePolicy() {
  return {
    r2Configured: isR2Configured(),
    archivesInlineDataUrls: true,
    archivesRemoteImages: true,
    archivesRemoteVideo: isTruthyEnv('AI_GATEWAY_MEDIA_ARCHIVE_REMOTE_VIDEO'),
    maxArchiveBytes: MAX_ARCHIVE_BYTES,
  };
}

async function putArchivedBuffer(plan, parsed, archiveCache, cacheKey) {
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

async function archiveInlineMedia(plan, value, archiveCache, stats) {
  const parsed = parseInlineMedia(value);
  if (!parsed || !isR2Configured()) return null;
  const cacheKey = `inline:${nonEmptyString(value).replace(/\s/g, '').slice(0, 120)}`;
  const archived = await putArchivedBuffer(plan, parsed, archiveCache, cacheKey);
  if (archived && stats) stats.archivedCount += 1;
  return archived;
}

async function archiveRemoteHttpMedia(plan, value, archiveCache, stats, { kindHint, fieldKey } = {}) {
  const url = nonEmptyString(value);
  if (!/^https?:\/\//i.test(url) || !isR2Configured()) return null;
  if (isAlreadyOurR2Url(url)) return null;
  if (looksLikeVideoUrl(url, kindHint) && !isTruthyEnv('AI_GATEWAY_MEDIA_ARCHIVE_REMOTE_VIDEO')) {
    if (stats) stats.skippedRemoteVideo += 1;
    return null;
  }
  if (!looksLikeImageUrl(url, kindHint, fieldKey) && String(kindHint || '').toLowerCase() !== 'image') {
    // Only pull remote images by default (C14); leave model/video supplier URLs alone.
    return null;
  }
  const cacheKey = `remote:${url}`;
  if (archiveCache?.has(cacheKey)) return archiveCache.get(cacheKey);

  const response = await undiciFetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (stats) stats.fetchFailures += 1;
    return null;
  }
  const mimeType = String(response.headers.get('content-type') || 'application/octet-stream')
    .split(';')[0]
    .trim() || 'application/octet-stream';
  if (mimeType.startsWith('video/') && !isTruthyEnv('AI_GATEWAY_MEDIA_ARCHIVE_REMOTE_VIDEO')) {
    if (stats) stats.skippedRemoteVideo += 1;
    return null;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_ARCHIVE_BYTES) {
    if (stats) stats.tooLarge += 1;
    return null;
  }
  const archived = await putArchivedBuffer(
    plan,
    { mimeType: mimeType.startsWith('image/') ? mimeType : 'image/png', buffer, bytes: buffer.length },
    archiveCache,
    cacheKey
  );
  if (archived && stats) {
    stats.archivedCount += 1;
    stats.archivedRemoteCount += 1;
  }
  return archived;
}

async function archiveStringMedia(plan, value, archiveCache, stats, ctx = {}) {
  const inline = await archiveInlineMedia(plan, value, archiveCache, stats);
  if (inline) return inline;
  return archiveRemoteHttpMedia(plan, value, archiveCache, stats, ctx);
}

async function replaceMediaUrls(plan, value, depth = 0, archiveCache = new Map(), stats, ctx = {}) {
  if (value == null || depth > 8) return value;
  if (typeof value === 'string') {
    const archived = await archiveStringMedia(plan, value, archiveCache, stats, ctx);
    return archived?.url || value;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await replaceMediaUrls(plan, item, depth + 1, archiveCache, stats, ctx));
    return out;
  }
  if (typeof value !== 'object') return value;
  const kindHint = nonEmptyString(value.kind || value.type || value.mediaKind) || ctx.kindHint;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') {
      const archived = await archiveStringMedia(plan, raw, archiveCache, stats, { kindHint, fieldKey: key });
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
    out[key] = await replaceMediaUrls(plan, raw, depth + 1, archiveCache, stats, {
      kindHint,
      fieldKey: key,
    });
  }
  return out;
}

function withMediaArchiveMeta(job, mediaArchive) {
  return {
    ...job,
    metadata: {
      ...(job.metadata && typeof job.metadata === 'object' ? job.metadata : {}),
      mediaArchive,
    },
  };
}

export async function archiveAiGatewayJobMedia(plan) {
  if (!plan?.job) return plan;
  if (!isR2Configured()) {
    return {
      ...plan,
      job: withMediaArchiveMeta(plan.job, {
        status: 'skipped',
        reason: 'r2_not_configured',
        warning: 'Job may keep data URLs / ephemeral supplier links; cross-device restore can 404 (C14)',
        at: new Date().toISOString(),
        policy: aiGatewayMediaArchivePolicy(),
      }),
    };
  }

  const job = { ...plan.job };
  const archiveCache = new Map();
  const stats = { archivedCount: 0, archivedRemoteCount: 0, skippedRemoteVideo: 0, fetchFailures: 0, tooLarge: 0 };
  if (job.output !== undefined) {
    job.output = await replaceMediaUrls(plan, job.output, 0, archiveCache, stats, {});
  }
  if (Array.isArray(job.artifacts)) {
    job.artifacts = await replaceMediaUrls(plan, job.artifacts, 0, archiveCache, stats, {});
  }

  return {
    ...plan,
    job: withMediaArchiveMeta(job, {
      status: stats.archivedCount > 0 ? 'ok' : 'noop',
      archivedCount: stats.archivedCount,
      archivedRemoteCount: stats.archivedRemoteCount,
      skippedRemoteVideo: stats.skippedRemoteVideo,
      fetchFailures: stats.fetchFailures,
      tooLarge: stats.tooLarge,
      at: new Date().toISOString(),
      policy: aiGatewayMediaArchivePolicy(),
    }),
  };
}
