import type { AssetSetComponent, AssetSetDoc, AssetSetSourceAsset } from '../../types';
import { resolveAssetSetComponentCropSrc, resolveAssetSetSourceAssetDisplaySrc } from './assetSetAsset';
import type { StoryboardNamedAssetImageFields } from '../storyboardNamedAssetImage';

export type AssetSetGenerationInputRef =
  | { kind: 'source'; sourceId: string }
  | { kind: 'component'; componentId: string };

export type AssetSetGenerationOutputMode = 'append' | 'styled' | 'multiview';

export function assetSetGenerationInputRefKey(ref: AssetSetGenerationInputRef): string {
  return ref.kind === 'source' ? `source:${ref.sourceId}` : `component:${ref.componentId}`;
}

export function parseAssetSetGenerationInputRefKey(
  key: string
): AssetSetGenerationInputRef | null {
  const trimmed = String(key || '').trim();
  if (trimmed.startsWith('source:')) {
    const sourceId = trimmed.slice('source:'.length);
    return sourceId ? { kind: 'source', sourceId } : null;
  }
  if (trimmed.startsWith('component:')) {
    const componentId = trimmed.slice('component:'.length);
    return componentId ? { kind: 'component', componentId } : null;
  }
  return null;
}

export function listAssetSetGenerationInputOptions(doc: AssetSetDoc): Array<{
  key: string;
  label: string;
  ref: AssetSetGenerationInputRef;
  hasImage: boolean;
}> {
  const out: Array<{
    key: string;
    label: string;
    ref: AssetSetGenerationInputRef;
    hasImage: boolean;
  }> = [];
  for (const source of doc.sourceAssets ?? []) {
    const hasImage = Boolean(resolveAssetSetSourceAssetDisplaySrc(source));
    const ref: AssetSetGenerationInputRef = { kind: 'source', sourceId: source.id };
    out.push({
      key: assetSetGenerationInputRefKey(ref),
      label: source.name?.trim() || source.slotKind || '参考图',
      ref,
      hasImage,
    });
  }
  for (const component of doc.components ?? []) {
    const hasImage = Boolean(resolveAssetSetComponentCropSrc(component));
    if (!hasImage) continue;
    const ref: AssetSetGenerationInputRef = { kind: 'component', componentId: component.id };
    const name = component.name?.trim() || `组件 ${component.index + 1}`;
    out.push({
      key: assetSetGenerationInputRefKey(ref),
      label: `${name}（裁切）`,
      ref,
      hasImage,
    });
  }
  return out;
}

export function defaultAssetSetGenerationInputRef(doc: AssetSetDoc): AssetSetGenerationInputRef | null {
  const original = doc.sourceAssets.find((s) => s.slotKind === 'original');
  if (original && resolveAssetSetSourceAssetDisplaySrc(original)) {
    return { kind: 'source', sourceId: original.id };
  }
  const firstWithImage = doc.sourceAssets.find((s) => resolveAssetSetSourceAssetDisplaySrc(s));
  if (firstWithImage) {
    return { kind: 'source', sourceId: firstWithImage.id };
  }
  return null;
}

export function resolveAssetSetGenerationInputFields(
  doc: AssetSetDoc,
  ref: AssetSetGenerationInputRef
): StoryboardNamedAssetImageFields | undefined {
  if (ref.kind === 'source') {
    const source = doc.sourceAssets.find((s) => s.id === ref.sourceId);
    if (!source) return undefined;
    return {
      image: source.image,
      imageCompanionKey: source.imageCompanionKey,
      imageObjectKey: source.imageObjectKey,
    };
  }
  const component = doc.components.find((c) => c.id === ref.componentId);
  if (!component) return undefined;
  return {
    image: component.cropPreview,
    imageCompanionKey: component.cropPreviewCompanionKey,
    imageObjectKey: component.cropPreviewObjectKey,
  };
}

export function nextAssetSetGenerationOutputName(sourceAssets: AssetSetSourceAsset[]): string {
  const genCount = sourceAssets.filter(
    (s) => s.slotKind === 'custom' && /^生成\s*\d+/.test(String(s.name || '').trim())
  ).length;
  return `生成 ${genCount + 1}`;
}

export const ASSET_SET_GENERATION_OUTPUT_OPTIONS: Array<{
  value: AssetSetGenerationOutputMode;
  label: string;
}> = [
  { value: 'append', label: '追加参考图' },
  { value: 'styled', label: '覆盖转风格槽' },
  { value: 'multiview', label: '覆盖多视角槽' },
];
