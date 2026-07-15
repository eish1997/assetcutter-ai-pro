import type {
  WorkflowAsset,
  WorkflowAssetKind,
  WorkflowAssetVariant,
  WorkflowAssetVariantKind,
} from '../types';
import {
  resolveWorkflowStepModelCompanionKeys,
  resolveWorkflowStepModelFormats,
  resolveWorkflowStepModelUrls,
} from './workflowStepModels';
import {
  hasWorkflowAssetSetPayload,
  hasWorkflowStoryboardTablePayload,
} from './workflowAssetKind';

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDisplayKey(asset: WorkflowAsset): string {
  return cleanString(asset.displayKey) || 'original';
}

function hasOwnValue(obj: Record<string, unknown> | undefined, key: string): boolean {
  return Boolean(obj && Object.prototype.hasOwnProperty.call(obj, key));
}

function kindFromMeta(asset: WorkflowAsset, key: string): WorkflowAssetVariantKind | null {
  const kind = asset.resultMeta?.[key]?.mediaKind;
  if (
    kind === 'text' ||
    kind === 'image' ||
    kind === 'video' ||
    kind === 'model3d' ||
    kind === 'audio' ||
    kind === 'file'
  ) {
    return kind;
  }
  return null;
}

function labelForVariant(asset: WorkflowAsset, key: string): string {
  if (key === 'original') {
    if (resolveWorkflowAssetKind(asset) === 'text') return 'Original text';
    return 'Original';
  }
  const label = cleanString(asset.resultMeta?.[key]?.displayStepLabel);
  return label || key;
}

function uniqueKeys(asset: WorkflowAsset): string[] {
  const keys = new Set<string>();
  keys.add('original');
  for (const key of asset.resultOrder || []) {
    const k = cleanString(key);
    if (k) keys.add(k);
  }
  for (const key of Object.keys(asset.results || {})) keys.add(key);
  for (const key of Object.keys(asset.textResults || {})) keys.add(key);
  for (const key of Object.keys(asset.resultMeta || {})) keys.add(key);
  for (const key of Object.keys(asset.resultsObjectKeys || {})) keys.add(key);
  for (const key of Object.keys(asset.resultsCompanionKeys || {})) keys.add(key);
  for (const key of Object.keys(asset.stepModelUrls || {})) keys.add(key);
  for (const key of Object.keys(asset.stepModelCompanionKeys || {})) keys.add(key);
  for (const key of Object.keys(asset.stepModelFormats || {})) keys.add(key);
  return [...keys];
}

function modelFormatFromUrlOrKey(url: string, key: string): 'glb' | 'gltf' | 'fbx' | 'obj' {
  const s = `${url} ${key}`.toLowerCase();
  if (s.includes('.gltf') || s.includes('_gltf')) return 'gltf';
  if (s.includes('.fbx') || s.includes('_fbx')) return 'fbx';
  if (s.includes('.obj') || s.includes('_obj')) return 'obj';
  return 'glb';
}

function hasTextPayload(asset: WorkflowAsset): boolean {
  if (cleanString(asset.textTitle) || cleanString(asset.textBody)) return true;
  return Object.values(asset.textResults || {}).some((value) => cleanString(value));
}

function hasModelPayload(asset: WorkflowAsset): boolean {
  if ((asset.modelUrls || []).some((value) => cleanString(value))) return true;
  if ((asset.modelCompanionKeys || []).some((value) => cleanString(value))) return true;
  return Object.values(asset.stepModelUrls || {}).some((list) => (list || []).some((value) => cleanString(value)));
}

export function resolveWorkflowAssetKind(asset: WorkflowAsset): WorkflowAssetKind {
  if (asset.isGroup === true) return 'group';
  if (asset.assetKind === 'storyboard_table' || hasWorkflowStoryboardTablePayload(asset)) return 'storyboard_table';
  if (asset.assetKind === 'asset_set' || hasWorkflowAssetSetPayload(asset)) return 'asset_set';
  if (
    asset.assetKind === 'text' ||
    asset.assetKind === 'video' ||
    asset.assetKind === 'model3d' ||
    asset.assetKind === 'audio' ||
    asset.assetKind === 'file'
  ) {
    return asset.assetKind;
  }
  if (hasModelPayload(asset) && !cleanString(asset.original) && Object.keys(asset.results || {}).length === 0) {
    return 'model3d';
  }
  if (hasTextPayload(asset) && !cleanString(asset.original) && Object.keys(asset.results || {}).length === 0) {
    return 'text';
  }
  return 'image';
}

function buildOriginalVariant(asset: WorkflowAsset): WorkflowAssetVariant | null {
  const assetKind = resolveWorkflowAssetKind(asset);
  if (assetKind === 'storyboard_table' || assetKind === 'asset_set' || assetKind === 'group') return null;
  if (assetKind === 'text') {
    const title = cleanString(asset.textTitle);
    const body = String(asset.textBody || '');
    if (!title && !cleanString(body)) return null;
    return {
      id: 'original',
      label: 'Original text',
      kind: 'text',
      source: 'original',
      text: title && cleanString(body) ? `${title}\n\n${body}` : body || title,
      meta: { title },
    };
  }

  const original = cleanString(asset.original);
  const objectKey = cleanString(asset.originalObjectKey);
  const companionKey = cleanString(asset.originalCompanionKey);
  if (!original && !objectKey && !companionKey) return null;
  return {
    id: 'original',
    label: assetKind === 'video' ? 'Original video' : assetKind === 'audio' ? 'Original audio' : 'Original',
    kind: assetKind === 'video' || assetKind === 'audio' || assetKind === 'file' ? assetKind : 'image',
    source: 'original',
    url: original || undefined,
    objectKey: objectKey || undefined,
    companionKey: companionKey || undefined,
  };
}

function buildModelVariant(asset: WorkflowAsset, key: string): WorkflowAssetVariant | null {
  const modelUrls = resolveWorkflowStepModelUrls(asset, key);
  const modelCompanionKeys = resolveWorkflowStepModelCompanionKeys(asset, key);
  const hasModel = modelUrls.some(Boolean) || modelCompanionKeys.some(Boolean) || kindFromMeta(asset, key) === 'model3d';
  if (!hasModel) return null;
  const formatsFromStep = resolveWorkflowStepModelFormats(asset, key);
  const modelFormats = modelUrls.map((url, index) => {
    const fromStep = formatsFromStep[index];
    if (fromStep === 'glb' || fromStep === 'fbx') return fromStep;
    return modelFormatFromUrlOrKey(url, modelCompanionKeys[index] || '');
  });
  const posterUrl = cleanString((asset.results || {})[key]);
  return {
    id: key,
    label: labelForVariant(asset, key),
    kind: 'model3d',
    source: key === 'original' ? 'original' : 'result',
    url: modelUrls.find(Boolean) || undefined,
    posterUrl: posterUrl || undefined,
    posterObjectKey: cleanString(asset.resultsObjectKeys?.[key]) || undefined,
    posterCompanionKey: cleanString(asset.resultsCompanionKeys?.[key]) || undefined,
    modelUrls,
    modelCompanionKeys,
    modelFormats,
    meta: asset.resultMeta?.[key],
  };
}

function buildTextVariant(asset: WorkflowAsset, key: string): WorkflowAssetVariant | null {
  if (key === 'original') return buildOriginalVariant(asset);
  if (!hasOwnValue(asset.textResults as Record<string, unknown> | undefined, key)) return null;
  const text = String(asset.textResults?.[key] || '');
  if (!cleanString(text)) return null;
  return {
    id: key,
    label: labelForVariant(asset, key),
    kind: 'text',
    source: 'result',
    text,
    meta: asset.resultMeta?.[key],
  };
}

function buildMediaVariant(asset: WorkflowAsset, key: string): WorkflowAssetVariant | null {
  if (key === 'original') return buildOriginalVariant(asset);
  const resultUrl = cleanString((asset.results || {})[key]);
  const objectKey = cleanString(asset.resultsObjectKeys?.[key]);
  const companionKey = cleanString(asset.resultsCompanionKeys?.[key]);
  const metaKind = kindFromMeta(asset, key);
  if (!resultUrl && !objectKey && !companionKey && !metaKind) return null;
  const kind: WorkflowAssetVariantKind =
    metaKind === 'text' || metaKind === 'model3d' ? 'image' : metaKind || 'image';
  return {
    id: key,
    label: labelForVariant(asset, key),
    kind,
    source: 'result',
    url: resultUrl || undefined,
    objectKey: objectKey || undefined,
    companionKey: companionKey || undefined,
    posterUrl: kind === 'video' ? resultUrl || undefined : undefined,
    meta: asset.resultMeta?.[key],
  };
}

export function resolveWorkflowAssetVariants(asset: WorkflowAsset): WorkflowAssetVariant[] {
  const byId = new Map<string, WorkflowAssetVariant>();
  for (const key of uniqueKeys(asset)) {
    const modelVariant = buildModelVariant(asset, key);
    if (modelVariant) {
      byId.set(key, modelVariant);
      continue;
    }
    const textVariant = buildTextVariant(asset, key);
    if (textVariant) {
      byId.set(key, textVariant);
      continue;
    }
    const mediaVariant = buildMediaVariant(asset, key);
    if (mediaVariant) byId.set(key, mediaVariant);
  }
  return [...byId.values()];
}

export function resolveWorkflowAssetActiveVariant(asset: WorkflowAsset): WorkflowAssetVariant | null {
  const variants = resolveWorkflowAssetVariants(asset);
  if (variants.length === 0) return null;
  const displayKey = normalizeDisplayKey(asset);
  return variants.find((variant) => variant.id === displayKey) || variants[0] || null;
}

export type WorkflowAssetCardPreview = {
  kind: WorkflowAssetVariantKind;
  variantId: string;
  label: string;
  url?: string;
  text?: string;
  posterUrl?: string;
  modelUrls?: string[];
};

export function resolveWorkflowAssetCardPreview(asset: WorkflowAsset): WorkflowAssetCardPreview | null {
  const variant = resolveWorkflowAssetActiveVariant(asset);
  if (!variant) return null;
  return {
    kind: variant.kind,
    variantId: variant.id,
    label: variant.label,
    url: variant.url,
    text: variant.text,
    posterUrl: variant.posterUrl,
    modelUrls: variant.modelUrls,
  };
}

export function workflowAssetVariantHasRasterPreview(variant: WorkflowAssetVariant | null | undefined): boolean {
  if (!variant) return false;
  if (variant.kind !== 'image' && variant.kind !== 'video') return false;
  return Boolean(cleanString(variant.url) || cleanString(variant.objectKey) || cleanString(variant.companionKey));
}

export function workflowAssetActiveVariantUsesVideoPreview(asset: WorkflowAsset): boolean {
  return resolveWorkflowAssetActiveVariant(asset)?.kind === 'video';
}

export function workflowAssetActiveVariantUsesModel3dPreview(asset: WorkflowAsset): boolean {
  return resolveWorkflowAssetActiveVariant(asset)?.kind === 'model3d';
}
