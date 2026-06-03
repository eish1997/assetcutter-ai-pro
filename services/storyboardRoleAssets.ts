import type { StoryboardRoleAsset } from '../types';
import { pickStoryboardNamedAssetImageFields } from './storyboardNamedAssetImage';

const roleAssetId = () => Math.random().toString(36).slice(2, 11);

export function defaultStoryboardRoleAssetName(index: number): string {
  return `角色${Math.max(1, index + 1)}`;
}

export function createStoryboardRoleAsset(partial?: Partial<StoryboardRoleAsset>, index = 0): StoryboardRoleAsset {
  const name =
    partial && 'name' in partial
      ? String(partial.name ?? '').trim()
      : defaultStoryboardRoleAssetName(index);
  return {
    id: partial?.id?.trim() || roleAssetId(),
    name,
    ...pickStoryboardNamedAssetImageFields(partial),
  };
}

export function normalizeStoryboardRoleAssets(raw: unknown): StoryboardRoleAsset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const asset = item as StoryboardRoleAsset;
      return createStoryboardRoleAsset(asset, index);
    })
    .filter((item): item is StoryboardRoleAsset => Boolean(item));
}

import { resolveStoryboardNamedAssetDisplaySrc } from './storyboardNamedAssetImage';

export function resolveStoryboardRoleAssetDisplaySrc(asset: StoryboardRoleAsset): string {
  return resolveStoryboardNamedAssetDisplaySrc(asset);
}

export function duplicateStoryboardRoleAssets(source: StoryboardRoleAsset[]): StoryboardRoleAsset[] {
  return source.map((item, index) =>
    createStoryboardRoleAsset(
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
