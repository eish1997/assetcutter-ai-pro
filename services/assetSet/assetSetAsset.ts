import type {
  AssetSetCategory,
  AssetSetComponent,
  AssetSetComponentModel3d,
  AssetSetComponentView,
  AssetSetDoc,
  AssetSetPanelPrefs,
  AssetSetSourceAsset,
  BoundingBox,
  WorkflowAsset,
} from '../../types';
import { resolveStoryboardNamedAssetDisplaySrc } from '../storyboardNamedAssetImage';
import { newStoryboardSheetSplitBoxId } from '../storyboardSheetVisionSplit';
import {
  createAssetSetSourceAsset,
  createDefaultAssetSetSourceAssets,
  normalizeAssetSetSourceAssets,
  resolveAssetSetSourceAssetBySlot,
} from './assetSetSourceAssets';

const rowId = () => Math.random().toString(36).slice(2, 11);

export function defaultAssetSetComponentName(index: number): string {
  return `组件 ${String(index + 1).padStart(2, '0')}`;
}

export function normalizeAssetSetComponentViews(raw: unknown): AssetSetComponentView[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const view = item as AssetSetComponentView;
      const role = String(view.role || '').trim() || `view_${index + 1}`;
      const image = String(view.image || '').trim() || undefined;
      const imageCompanionKey = String(view.imageCompanionKey || '').trim() || undefined;
      const imageObjectKey = String(view.imageObjectKey || '').trim() || undefined;
      return {
        id: String(view.id || '').trim() || rowId(),
        role,
        ...(image ? { image } : {}),
        ...(imageCompanionKey ? { imageCompanionKey } : {}),
        ...(imageObjectKey ? { imageObjectKey } : {}),
      };
    })
    .filter((item): item is AssetSetComponentView => Boolean(item));
}

function normalizeBoundingBox(raw: unknown, fallbackLabel: string): BoundingBox {
  const box = (raw && typeof raw === 'object' ? raw : {}) as BoundingBox;
  return {
    id: String(box.id || '').trim() || newStoryboardSheetSplitBoxId(),
    label: String(box.label || '').trim() || fallbackLabel,
    xmin: Number(box.xmin) || 0,
    ymin: Number(box.ymin) || 0,
    xmax: Number(box.xmax) || 1000,
    ymax: Number(box.ymax) || 1000,
  };
}

function normalizeModel3d(raw: unknown): AssetSetComponentModel3d | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as AssetSetComponentModel3d;
  const status = m.status;
  if (!status || status === 'idle') return undefined;
  return {
    status,
    jobId: m.jobId?.trim() || undefined,
    provider: m.provider?.trim() || undefined,
    error: m.error?.trim() || undefined,
    files: Array.isArray(m.files) ? m.files.filter(Boolean) : undefined,
    fileCompanionKeys: Array.isArray(m.fileCompanionKeys)
      ? m.fileCompanionKeys.filter(Boolean)
      : undefined,
    previewUrl: m.previewUrl?.trim() || undefined,
    updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : undefined,
  };
}

export function createAssetSetComponent(
  partial?: Partial<AssetSetComponent>,
  index = 0
): AssetSetComponent {
  const cropRegion = normalizeBoundingBox(
    partial?.cropRegion,
    String(index + 1)
  );
  return {
    id: partial?.id?.trim() || rowId(),
    index,
    name: partial?.name?.trim() || defaultAssetSetComponentName(index),
    cropSource: 'styled',
    cropRegion,
    cropPreview: partial?.cropPreview?.trim() || undefined,
    cropPreviewCompanionKey: partial?.cropPreviewCompanionKey?.trim() || undefined,
    cropPreviewObjectKey: partial?.cropPreviewObjectKey?.trim() || undefined,
    multiviewSheet: partial?.multiviewSheet?.trim() || undefined,
    multiviewSheetCompanionKey: partial?.multiviewSheetCompanionKey?.trim() || undefined,
    multiviewSheetObjectKey: partial?.multiviewSheetObjectKey?.trim() || undefined,
    views: normalizeAssetSetComponentViews(partial?.views),
    model3d: normalizeModel3d(partial?.model3d),
    locked: Boolean(partial?.locked),
  };
}

export function normalizeAssetSetComponents(raw: unknown): AssetSetComponent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      return createAssetSetComponent(item as AssetSetComponent, index);
    })
    .filter((item): item is AssetSetComponent => Boolean(item))
    .map((item, index) => ({ ...item, index }));
}

function normalizePanelPrefs(raw: unknown): AssetSetPanelPrefs | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as AssetSetPanelPrefs;
  const out: AssetSetPanelPrefs = {};
  if (p.stylePresetId?.trim()) out.stylePresetId = p.stylePresetId.trim();
  if (p.assetMultiviewPresetId?.trim()) out.assetMultiviewPresetId = p.assetMultiviewPresetId.trim();
  if (p.componentSheetPresetId?.trim()) out.componentSheetPresetId = p.componentSheetPresetId.trim();
  if (p.single3dPresetId?.trim()) out.single3dPresetId = p.single3dPresetId.trim();
  if (p.multi3dPresetId?.trim()) out.multi3dPresetId = p.multi3dPresetId.trim();
  return Object.keys(out).length ? out : undefined;
}

export function normalizeAssetSetDoc(raw: AssetSetDoc | undefined | null): AssetSetDoc {
  const category: AssetSetCategory =
    raw?.category === 'scene' || raw?.category === 'prop' ? raw.category : 'character';
  const sourceAssets = normalizeAssetSetSourceAssets(raw?.sourceAssets);
  const components = normalizeAssetSetComponents(raw?.components);
  return {
    title: typeof raw?.title === 'string' ? raw.title : undefined,
    category,
    sourceAssets: sourceAssets.length ? sourceAssets : createDefaultAssetSetSourceAssets(),
    components,
    panelPrefs: normalizePanelPrefs(raw?.panelPrefs),
  };
}

export function hasWorkflowAssetSetPayload(a: WorkflowAsset): boolean {
  const doc = a.assetSet;
  return Boolean(doc && typeof doc === 'object' && Array.isArray(doc.sourceAssets));
}

export function isWorkflowAssetSetAsset(a: WorkflowAsset): boolean {
  return a.assetKind === 'asset_set' || hasWorkflowAssetSetPayload(a);
}

export function upgradeLegacyWorkflowAssetSetAsset(asset: WorkflowAsset): WorkflowAsset {
  if (!hasWorkflowAssetSetPayload(asset)) return asset;
  if (asset.assetKind === 'asset_set') return normalizeAssetSetOnAsset(asset);
  return normalizeAssetSetOnAsset({ ...asset, assetKind: 'asset_set' });
}

export function readAssetSetTitleRaw(asset: WorkflowAsset): string {
  const fromDoc = String(asset.assetSet?.title ?? '').trim();
  if (fromDoc) return fromDoc;
  return String(asset.textTitle ?? '').trim();
}

export function resolveAssetSetTitle(asset: WorkflowAsset): string {
  const raw = readAssetSetTitleRaw(asset);
  return raw || '资产集';
}

export function normalizeAssetSetOnAsset(asset: WorkflowAsset): WorkflowAsset {
  if (!isWorkflowAssetSetAsset(asset)) return asset;
  const doc = normalizeAssetSetDoc(asset.assetSet);
  const titleRaw = readAssetSetTitleRaw(asset);
  const { isGroup: _ig, assetIds: _ai, cutImageGroup: _cig, parentAssetId: _pid, ...rest } = asset;
  return {
    ...rest,
    assetKind: 'asset_set',
    textTitle: titleRaw,
    original: '',
    displayKey: 'original',
    results: rest.results ?? {},
    assetSet: {
      ...doc,
      title: titleRaw || doc.title,
    },
  };
}

export type CreateAssetSetAssetOptions = {
  title?: string;
  category?: AssetSetCategory;
  originalImageDataUrl?: string;
};

export function createAssetSetAsset(
  id: string,
  options: CreateAssetSetAssetOptions = {}
): WorkflowAsset {
  const label = options.title !== undefined ? options.title.trim() || '资产集' : '资产集';
  const category = options.category ?? 'character';
  return normalizeAssetSetOnAsset({
    id,
    assetKind: 'asset_set',
    textTitle: label,
    original: '',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: Date.now(),
    assetSet: {
      title: label,
      category,
      sourceAssets: createDefaultAssetSetSourceAssets(options.originalImageDataUrl),
      components: [],
    },
  });
}

export type AssetSetStats = {
  componentCount: number;
  withViewsCount: number;
  withModelCount: number;
  hasStyledImage: boolean;
};

export function computeAssetSetStats(doc: AssetSetDoc): AssetSetStats {
  const components = doc.components ?? [];
  const styled = resolveAssetSetSourceAssetBySlot(doc.sourceAssets, 'styled');
  const hasStyledImage = Boolean(resolveAssetSetSourceAssetDisplaySrc(styled));
  return {
    componentCount: components.length,
    withViewsCount: components.filter((c) => c.views.some((v) => resolveAssetSetComponentViewSrc(v))).length,
    withModelCount: components.filter((c) => c.model3d?.status === 'done').length,
    hasStyledImage,
  };
}

export function resolveAssetSetSourceAssetDisplaySrc(
  asset: AssetSetSourceAsset | undefined
): string {
  if (!asset) return '';
  return resolveStoryboardNamedAssetDisplaySrc(asset);
}

export function resolveAssetSetComponentViewSrc(view: AssetSetComponentView): string {
  return resolveStoryboardNamedAssetDisplaySrc(view);
}

export function resolveAssetSetComponentMultiviewSheetSrc(component: AssetSetComponent): string {
  const direct = String(component.multiviewSheet || '').trim();
  if (direct) return direct;
  return resolveStoryboardNamedAssetDisplaySrc({
    image: component.multiviewSheet,
    imageCompanionKey: component.multiviewSheetCompanionKey,
    imageObjectKey: component.multiviewSheetObjectKey,
  });
}

export function resolveAssetSetComponentCropSrc(component: AssetSetComponent): string {
  const crop = String(component.cropPreview || '').trim();
  if (crop) return crop;
  if (component.cropPreviewCompanionKey || component.cropPreviewObjectKey) {
    return resolveStoryboardNamedAssetDisplaySrc({
      image: component.cropPreview,
      imageCompanionKey: component.cropPreviewCompanionKey,
      imageObjectKey: component.cropPreviewObjectKey,
    });
  }
  return '';
}

export function assetSetOutlineLabel(asset: WorkflowAsset): string {
  const stats = computeAssetSetStats(normalizeAssetSetDoc(asset.assetSet));
  const categoryLabel =
    asset.assetSet?.category === 'scene'
      ? '场景'
      : asset.assetSet?.category === 'prop'
        ? '道具'
        : '角色';
  return `${resolveAssetSetTitle(asset)} · ${categoryLabel} · ${stats.componentCount} 组件`;
}

export function assetSetPreviewImages(asset: WorkflowAsset, limit = 4): string[] {
  const components = asset.assetSet?.components ?? [];
  const out: string[] = [];
  for (const c of components) {
    const src = resolveAssetSetComponentCropSrc(c);
    if (!src) continue;
    out.push(src);
    if (out.length >= limit) break;
  }
  if (out.length < limit) {
    for (const s of asset.assetSet?.sourceAssets ?? []) {
      const src = resolveAssetSetSourceAssetDisplaySrc(s);
      if (!src || out.includes(src)) continue;
      out.push(src);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function patchAssetSetDoc(
  doc: AssetSetDoc,
  patch: Partial<AssetSetDoc> | ((prev: AssetSetDoc) => AssetSetDoc)
): AssetSetDoc {
  const next = typeof patch === 'function' ? patch(doc) : { ...doc, ...patch };
  return normalizeAssetSetDoc(next);
}

export function patchAssetSetComponents(
  doc: AssetSetDoc,
  componentIds: string[],
  patch: Partial<AssetSetComponent> | ((prev: AssetSetComponent) => AssetSetComponent)
): AssetSetDoc {
  const idSet = new Set(componentIds);
  return patchAssetSetDoc(doc, (prev) => ({
    ...prev,
    components: prev.components.map((component) => {
      if (!idSet.has(component.id)) return component;
      const next =
        typeof patch === 'function' ? patch(component) : { ...component, ...patch };
      return createAssetSetComponent(next, component.index);
    }),
  }));
}

export function listAssetSetSheetEligibleComponents(components: AssetSetComponent[]): AssetSetComponent[] {
  return components.filter((c) => !c.locked && Boolean(resolveAssetSetComponentCropSrc(c)));
}

export function listAssetSet3dEligibleComponents(components: AssetSetComponent[]): AssetSetComponent[] {
  return components.filter(
    (c) => !c.locked && c.views.some((v) => resolveAssetSetComponentViewSrc(v))
  );
}
