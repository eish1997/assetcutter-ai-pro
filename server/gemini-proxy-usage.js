/**
 * Re-export shared extractor (gemini-proxy tests import this path).
 */
export {
  extractUsageMetadata,
  extractUsageMetadataFromProxyResult,
} from '../shared/extractUsageMetadata.js';

import { extractUsageMetadataFromProxyResult } from '../shared/extractUsageMetadata.js';

function estimateBase64Bytes(value) {
  const data = String(value || '').replace(/\s+/g, '');
  if (!data) return 0;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function artifactKindForMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.includes('gltf') || mime.includes('model')) return 'model3d';
  return 'file';
}

function collectInlineArtifacts(value, out, path = '$', depth = 0) {
  if (!value || out.length >= 20 || depth > 8) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectInlineArtifacts(item, out, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  const record = value;
  const inlineData = record.inlineData && typeof record.inlineData === 'object' ? record.inlineData : record;
  const mimeType = typeof inlineData.mimeType === 'string' ? inlineData.mimeType : '';
  const data = typeof inlineData.data === 'string' ? inlineData.data : '';
  if (mimeType && data && /^(image|video)\//i.test(mimeType)) {
    out.push({
      id: `artifact_${out.length + 1}`,
      label: `${artifactKindForMime(mimeType)} ${out.length + 1}`,
      kind: artifactKindForMime(mimeType),
      mimeType,
      bytes: estimateBase64Bytes(data),
      inlineData: true,
      sourcePath: record.inlineData ? `${path}.inlineData` : path,
    });
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === 'inlineData' && record.inlineData && typeof record.inlineData === 'object') continue;
    if (key === 'data' && typeof child === 'string' && mimeType) continue;
    collectInlineArtifacts(child, out, `${path}.${key}`, depth + 1);
  }
}

function redactInlineData(value, depth = 0) {
  if (value == null || depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => redactInlineData(item, depth + 1));
  if (typeof value !== 'object') return value;
  const record = value;
  const next = {};
  const mimeType = typeof record.mimeType === 'string' ? record.mimeType : '';
  for (const [key, child] of Object.entries(record)) {
    if (key === 'data' && typeof child === 'string' && mimeType && /^(image|video)\//i.test(mimeType)) {
      next.data = `[REDACTED_BASE64:${estimateBase64Bytes(child)}B]`;
      next.bytes = estimateBase64Bytes(child);
      next.redacted = true;
    } else {
      next[key] = redactInlineData(child, depth + 1);
    }
  }
  return next;
}

export function extractAiGatewayArtifactsFromProxyResult(result) {
  const artifacts = [];
  collectInlineArtifacts(result, artifacts);
  return artifacts;
}

export function sanitizeProxyResultForAiGatewayJob(result) {
  return redactInlineData(result);
}

export function buildAiGatewayTraceSuccessMetadata(jobId, result) {
  const usageMetadata = extractUsageMetadataFromProxyResult(result);
  return {
    proxyJobId: jobId,
    proxyStatus: 'completed',
    ...(usageMetadata ? { usage: { usageMetadata } } : {}),
  };
}
