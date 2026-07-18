/**
 * Re-export shared extractor (ai-worker-proxy tests import this path).
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

function stringField(record, keys) {
  for (const key of keys) {
    const value = record && typeof record === 'object' ? record[key] : undefined;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function mimeTypeFromRecord(record) {
  return stringField(record, ['mimeType', 'mime_type', 'mime', 'contentType', 'content_type']);
}

function collectFileArtifacts(record, out, path) {
  const fileData = record.fileData && typeof record.fileData === 'object' ? record.fileData : null;
  const source = fileData || record;
  const uri = stringField(source, ['fileUri', 'file_uri', 'url', 'uri', 'publicUrl', 'downloadUrl']);
  if (!uri) return;
  const mimeType = mimeTypeFromRecord(source) || mimeTypeFromRecord(record);
  if (!mimeType || !/^(image|video)\//i.test(mimeType)) return;
  const kind = artifactKindForMime(mimeType);
  out.push({
    id: `artifact_${out.length + 1}`,
    label: `${kind} ${out.length + 1}`,
    kind,
    mimeType,
    url: uri,
    previewUrl: uri,
    sourcePath: fileData ? `${path}.fileData` : path,
  });
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
  const mimeType = mimeTypeFromRecord(inlineData);
  const data = stringField(inlineData, ['data', 'base64', 'b64Json', 'b64_json']);
  if (mimeType && data && /^(image|video)\//i.test(mimeType)) {
    const kind = artifactKindForMime(mimeType);
    const url = `data:${mimeType};base64,${data}`;
    out.push({
      id: `artifact_${out.length + 1}`,
      label: `${kind} ${out.length + 1}`,
      kind,
      mimeType,
      bytes: estimateBase64Bytes(data),
      inlineData: true,
      url,
      dataUrl: url,
      sourcePath: record.inlineData ? `${path}.inlineData` : path,
    });
  }
  collectFileArtifacts(record, out, path);
  for (const [key, child] of Object.entries(record)) {
    if (key === 'inlineData' && record.inlineData && typeof record.inlineData === 'object') continue;
    if (key === 'fileData' && record.fileData && typeof record.fileData === 'object') continue;
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
