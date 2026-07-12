import type { AiJobDetail } from './aiJobsClient';

export type RestorableAiJobArtifact = {
  id: string;
  label: string;
  url: string;
  mimeType: string | null;
  kind: 'image' | 'video' | 'model3d' | 'file';
};

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
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
  'modelUrl',
  'model_url',
]);

function classifyUrl(url: string, mimeType?: string | null): RestorableAiJobArtifact['kind'] {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/') || url.startsWith('data:image/') || IMAGE_EXT.test(url)) return 'image';
  if (mime.startsWith('video/') || url.startsWith('data:video/') || VIDEO_EXT.test(url)) return 'video';
  if (MODEL_EXT.test(url) || mime.includes('model') || mime.includes('gltf')) return 'model3d';
  return 'file';
}

function looksLikeRestorableUrl(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  if (/^data:(image|video)\//i.test(s)) return true;
  if (!/^https?:\/\//i.test(s) && !s.startsWith('/')) return false;
  return IMAGE_EXT.test(s) || VIDEO_EXT.test(s) || MODEL_EXT.test(s);
}

function readStringField(record: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = record[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function collectCandidates(value: unknown, out: Array<{ url: string; mimeType: string | null; label: string }>, depth = 0) {
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
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === 'string' && URL_FIELD_NAMES.has(key) && looksLikeRestorableUrl(child)) {
      out.push({ url: child.trim(), mimeType, label });
    } else {
      collectCandidates(child, out, depth + 1);
    }
  }
}

export function extractRestorableAiJobArtifacts(detail: AiJobDetail): RestorableAiJobArtifact[] {
  const candidates: Array<{ url: string; mimeType: string | null; label: string }> = [];
  collectCandidates(detail.job.artifacts, candidates);
  collectCandidates(detail.job.output, candidates);

  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .slice(0, 12)
    .map((candidate, index) => {
      const kind = classifyUrl(candidate.url, candidate.mimeType);
      return {
        id: `${detail.job.id}:${index}`,
        label: candidate.label || `${kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'model3d' ? '模型' : '文件'} ${index + 1}`,
        url: candidate.url,
        mimeType: candidate.mimeType,
        kind,
      };
    });
}
