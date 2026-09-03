import type { WorkflowAsset, WorkflowAssetVariant } from '../types';
import { resolveWorkflowAssetActiveVariant, resolveWorkflowAssetKind } from './workflowAssetVariants';
import { workshopPreviewExt } from './workshopPreviewKind';

const MIME_TO_SUFFIX: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/jpg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/gif': 'GIF',
  'image/bmp': 'BMP',
  'image/tiff': 'TIFF',
  'image/x-exr': 'EXR',
  'image/vnd.radiance': 'HDR',
  'image/vnd.adobe.photoshop': 'PSD',
  'video/mp4': 'MP4',
  'video/webm': 'WEBM',
  'video/quicktime': 'MOV',
  'audio/mpeg': 'MP3',
  'audio/wav': 'WAV',
  'audio/x-wav': 'WAV',
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'model/gltf-binary': 'GLB',
  'model/gltf+json': 'GLTF',
};

function normalizeSuffix(raw: string): string {
  const s = String(raw || '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase();
  if (!s) return '';
  if (s === 'jpeg') return 'JPG';
  if (!/^[a-z0-9]{1,8}$/.test(s)) return '';
  return s.toUpperCase();
}

function suffixFromDataUrl(value: string): string {
  const m = String(value || '').match(/^data:([^;,]+)/i);
  if (!m) return '';
  const mime = String(m[1] || '').trim().toLowerCase();
  if (MIME_TO_SUFFIX[mime]) return MIME_TO_SUFFIX[mime];
  const sub = mime.split('/')[1] || '';
  if (!sub || sub === 'octet-stream') return '';
  return normalizeSuffix(sub.replace(/\+.*$/, ''));
}

export function formatSuffixFromFileName(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^data:/i.test(raw)) return suffixFromDataUrl(raw);
  let pathPart = raw;
  try {
    if (/^(https?:|blob:|ac-workshop:)/i.test(raw)) {
      pathPart = decodeURIComponent(new URL(raw).pathname || '');
    }
  } catch {
    /* keep raw */
  }
  const noQuery = pathPart.split('?')[0].split('#')[0];
  return normalizeSuffix(workshopPreviewExt(noQuery));
}

function collectNameCandidates(asset: WorkflowAsset, variant: WorkflowAssetVariant | null): string[] {
  const key = String(variant?.id || asset.displayKey || 'original').trim() || 'original';
  const kind = variant?.kind || resolveWorkflowAssetKind(asset);
  const slotSrc = key === 'original' ? asset.original : String((asset.results || {})[key] || '');
  const names = [asset.modelSourceName, asset.textTitle, asset.id, ...(variant?.modelUrls || []), ...(variant?.modelCompanionKeys || [])];
  if (kind !== 'model3d') {
    names.push(variant?.url, slotSrc, asset.original);
  }
  return names.map((item) => String(item || '').trim()).filter(Boolean);
}

export function workflowAssetFormatBadgeLabel(
  asset: WorkflowAsset,
  variant?: WorkflowAssetVariant | null,
): string {
  const active = variant === undefined ? resolveWorkflowAssetActiveVariant(asset) : variant;
  for (const name of collectNameCandidates(asset, active)) {
    const suffix = formatSuffixFromFileName(name);
    if (suffix) return suffix;
  }
  const format = String(active?.modelFormats?.[0] || '').trim();
  return normalizeSuffix(format);
}
