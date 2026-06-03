import type { StoryboardSceneAsset } from '../types';
import { pickStoryboardNamedAssetImageFields, resolveStoryboardNamedAssetDisplaySrc } from './storyboardNamedAssetImage';

const sceneAssetId = () => Math.random().toString(36).slice(2, 11);

export function defaultStoryboardSceneAssetName(index: number): string {
  return `场景${Math.max(1, index + 1)}`;
}

export function createStoryboardSceneAsset(
  partial?: Partial<StoryboardSceneAsset>,
  index = 0
): StoryboardSceneAsset {
  const name =
    partial && 'name' in partial
      ? String(partial.name ?? '').trim()
      : defaultStoryboardSceneAssetName(index);
  return {
    id: partial?.id?.trim() || sceneAssetId(),
    name,
    ...pickStoryboardNamedAssetImageFields(partial),
  };
}

export function normalizeStoryboardSceneAssets(raw: unknown): StoryboardSceneAsset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const asset = item as StoryboardSceneAsset;
      return createStoryboardSceneAsset(asset, index);
    })
    .filter((item): item is StoryboardSceneAsset => Boolean(item));
}

export function resolveStoryboardSceneAssetDisplaySrc(asset: StoryboardSceneAsset): string {
  return resolveStoryboardNamedAssetDisplaySrc(asset);
}

export function duplicateStoryboardSceneAssets(source: StoryboardSceneAsset[]): StoryboardSceneAsset[] {
  return source.map((item, index) =>
    createStoryboardSceneAsset(
      {
        name: item.name,
        image: item.image,
        imageCompanionKey: item.imageCompanionKey,
        imageObjectKey: item.imageObjectKey,
      },
      index
    )
  );
}
