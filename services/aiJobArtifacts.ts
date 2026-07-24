import type { GeneratedAssetSourceMeta } from '../types';
import type { AiJobDetail } from './aiJobsClient';

export type RestorableAiJobArtifact = {
  id: string;
  label: string;
  url?: string;
  text?: string;
  mimeType: string | null;
  kind: 'text' | 'image' | 'video' | 'model3d' | 'audio' | 'file';
  source?: GeneratedAssetSourceMeta;
};

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac)(\?|#|$)/i;
const MODEL_EXT = /\.(glb|gltf|fbx|obj|stl|usdz)(\?|#|$)/i;
const URL_FIELD_NAMES = new Set([
  'url',
  'uri',
  'href',
  'src',
  'data',
  'dataUrl',
  'data_url',
  'image',
  'imageUrl',
  'image_url',
  'preview',
  'previewUrl',
  'preview_url',
  'videoUrl',
  'video_url',
  'audio',
  'audioUrl',
  'audio_url',
  'music',
  'musicUrl',
  'music_url',
  'modelUrl',
  'model_url',
]);
const TEXT_FIELD_NAMES = new Set([
  'text',
  'outputText',
  'output_text',
  'content',
  'result',
  'response',
  'answer',
  'markdown',
]);

function classifyUrl(url: string, mimeType?: string | null, kindHint?: unknown): RestorableAiJobArtifact['kind'] {
  const mime = String(mimeType || '').toLowerCase();
  const kind = String(kindHint || '').toLowerCase();
  if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'model3d' || kind === 'file') {
    return kind;
  }
  if (mime.startsWith('image/') || url.startsWith('data:image/') || IMAGE_EXT.test(url)) return 'image';
  if (mime.startsWith('video/') || url.startsWith('data:video/') || VIDEO_EXT.test(url)) return 'video';
  if (mime.startsWith('audio/') || url.startsWith('data:audio/') || AUDIO_EXT.test(url)) return 'audio';
  if (MODEL_EXT.test(url) || mime.includes('model') || mime.includes('gltf')) return 'model3d';
  return 'file';
}

function looksLikeRestorableUrl(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  if (/^\[REDACTED_/i.test(s)) return false;
  if (/^data:(image|video|audio)\//i.test(s)) return true;
  if (!/^https?:\/\//i.test(s) && !s.startsWith('/')) return false;
  return IMAGE_EXT.test(s) || VIDEO_EXT.test(s) || AUDIO_EXT.test(s) || MODEL_EXT.test(s);
}

function mimeOrKindSuggestsMedia(mimeType: string | null, kind: unknown): boolean {
  const mime = String(mimeType || '').toLowerCase();
  const k = String(kind || '').toLowerCase();
  return (
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime.includes('model') ||
    mime.includes('gltf') ||
    k === 'image' ||
    k === 'video' ||
    k === 'audio' ||
    k === 'model3d' ||
    k === 'file'
  );
}

function readStringField(record: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = record[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function readNestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readMetaString(record: Record<string, unknown> | null, names: string[]): string | null {
  if (!record) return null;
  for (const name of names) {
    const value = record[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

export function buildAiJobArtifactSource(detail: AiJobDetail): GeneratedAssetSourceMeta {
  const metadata = readNestedRecord(detail.job.metadata);
  const publication = readNestedRecord(metadata?.modelPublication);
  const route = detail.route || detail.job.route || null;
  const routeRecord = readNestedRecord(route);
  const paramsSnapshot = firstDefined(
    metadata?.paramsSnapshot,
    metadata?.parameterSnapshot,
    metadata?.parametersSnapshot,
    metadata?.generationParamsSnapshot
  );
  return {
    source: 'ai_gateway',
    aiGatewayJobId: detail.job.id,
    providerId: route?.providerId || detail.job.provider || readMetaString(metadata, ['providerId', 'provider']) || null,
    modelId: detail.job.model || readMetaString(metadata, ['modelId', 'model']) || null,
    canonicalModelId: readMetaString(metadata, ['canonicalModelId']) || readMetaString(publication, ['canonicalModelId']) || null,
    registryId: readMetaString(metadata, ['registryId']) || readMetaString(publication, ['registryId']) || null,
    modality: detail.job.modality || null,
    capability: detail.job.capability || null,
    createdAt: detail.job.createdAt || null,
    routeId: readMetaString(routeRecord, ['ruleId', 'routeId']),
    adapterId: route?.adapterId || null,
    ...(paramsSnapshot !== undefined ? { paramsSnapshot } : {}),
  };
}

function collectCandidates(
  value: unknown,
  out: Array<{ url: string; mimeType: string | null; label: string; kindHint?: unknown }>,
  depth = 0
) {
  if (out.length >= 40 || depth > 5 || value == null) return;
  if (typeof value === 'string') {
    if (looksLikeRestorableUrl(value)) out.push({ url: value.trim(), mimeType: null, label: '' });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, out, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const label = readStringField(record, ['label', 'name', 'filename', 'fileName', 'title']);
  const mimeType = readStringField(record, ['mimeType', 'mime_type', 'contentType', 'content_type']) || null;
  const mediaHint = mimeOrKindSuggestsMedia(mimeType, record.kind);
  for (const [key, child] of Object.entries(record)) {
    if (
      typeof child === 'string' &&
      URL_FIELD_NAMES.has(key) &&
      (looksLikeRestorableUrl(child) || (mediaHint && (/^https?:\/\//i.test(child.trim()) || child.trim().startsWith('/'))))
    ) {
      out.push({ url: child.trim(), mimeType, label, kindHint: record.kind });
    } else {
      collectCandidates(child, out, depth + 1);
    }
  }
}

function shouldCollectTextArtifacts(detail: AiJobDetail): boolean {
  return detail.job.modality === 'text' || String(detail.job.capability || '').toLowerCase().includes('text');
}

function looksLikeRestorableText(value: string): boolean {
  const s = value.trim();
  if (s.length < 2) return false;
  if (looksLikeRestorableUrl(s)) return false;
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return false;
  return true;
}

function collectTextCandidates(value: unknown, out: Array<{ text: string; label: string }>, depth = 0) {
  if (out.length >= 12 || depth > 5 || value == null) return;
  if (typeof value === 'string') {
    if (depth === 0 && looksLikeRestorableText(value)) out.push({ text: value.trim(), label: '' });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextCandidates(item, out, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const label = readStringField(record, ['label', 'name', 'title']);
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === 'string' && TEXT_FIELD_NAMES.has(key) && looksLikeRestorableText(child)) {
      out.push({ text: child.trim(), label });
    } else {
      collectTextCandidates(child, out, depth + 1);
    }
  }
}

export function extractRestorableAiJobArtifacts(detail: AiJobDetail): RestorableAiJobArtifact[] {
  const source = buildAiJobArtifactSource(detail);
  const contractArtifacts = Array.isArray(detail.job.artifacts) ? detail.job.artifacts : [];
  const fromContract: RestorableAiJobArtifact[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < contractArtifacts.length && fromContract.length < 12; index += 1) {
    const row = contractArtifacts[index];
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const kindHint = String(record.kind || '').toLowerCase() === 'music' ? 'audio' : record.kind;
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : null;
    if (url) {
      if (seen.has(url)) continue;
      seen.add(url);
      const kind = classifyUrl(url, mimeType, kindHint);
      fromContract.push({
        id: `${detail.job.id}:${index}`,
        label: `${kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'model3d' ? '模型' : kind === 'audio' ? '音频' : '文件'} ${fromContract.length + 1}`,
        url,
        mimeType,
        kind,
        source,
      });
      continue;
    }
    if (text && (kindHint === 'text' || shouldCollectTextArtifacts(detail))) {
      if (seen.has(text)) continue;
      seen.add(text);
      fromContract.push({
        id: `${detail.job.id}:text:${index}`,
        label: `文本 ${fromContract.length + 1}`,
        text,
        mimeType: mimeType || 'text/plain',
        kind: 'text',
        source,
      });
    }
  }

  if (fromContract.length > 0) {
    return fromContract;
  }

  // Legacy fallback only when contract artifacts are empty (pre-slice-4 jobs).
  const candidates: Array<{ url: string; mimeType: string | null; label: string; kindHint?: unknown }> = [];
  collectCandidates(detail.job.artifacts, candidates);
  collectCandidates(detail.job.output, candidates);
  const textCandidates: Array<{ text: string; label: string }> = [];
  if (shouldCollectTextArtifacts(detail)) {
    collectTextCandidates(detail.job.artifacts, textCandidates);
    collectTextCandidates(detail.job.output, textCandidates);
  }

  const mediaArtifacts = candidates
    .filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .slice(0, 12)
    .map((candidate, index) => {
      const kind = classifyUrl(candidate.url, candidate.mimeType, candidate.kindHint);
      return {
        id: `${detail.job.id}:${index}`,
        label: candidate.label || `${kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'model3d' ? '模型' : '文件'} ${index + 1}`,
        url: candidate.url,
        mimeType: candidate.mimeType,
        kind,
        source,
      };
    });
  const seenText = new Set<string>();
  const textArtifacts = textCandidates
    .filter((candidate) => {
      if (seenText.has(candidate.text)) return false;
      seenText.add(candidate.text);
      return true;
    })
    .slice(0, Math.max(0, 12 - mediaArtifacts.length))
    .map((candidate, index) => ({
      id: `${detail.job.id}:text:${index}`,
      label: candidate.label || `文本 ${index + 1}`,
      text: candidate.text,
      mimeType: 'text/plain' as const,
      kind: 'text' as const,
      source,
    }));

  return [...mediaArtifacts, ...textArtifacts];
}
