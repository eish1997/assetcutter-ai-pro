import React from 'react';
import type { AssetSetSourceAsset } from '../../types';
import StoryboardRoleAssetStrip from '../storyboard/StoryboardRoleAssetStrip';
import { resolveAssetSetSourceAssetDisplaySrc } from '../../services/assetSet/assetSetAsset';

type Props = {
  assets: AssetSetSourceAsset[];
  readOnly?: boolean;
  busyId?: string | null;
  highlightInputId?: string | null;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAssignImage: (id: string, file: File) => void;
  onClearImage: (id: string) => void;
  onPreviewImage?: (src: string) => void;
  onUseAsGenerationInput?: (asset: AssetSetSourceAsset) => void;
  onSplitFromAsset?: (asset: AssetSetSourceAsset) => void;
  onSourceAssetImageClick?: (asset: AssetSetSourceAsset) => boolean;
};

export default function AssetSetSourceStrip({
  assets,
  readOnly = false,
  busyId = null,
  highlightInputId = null,
  onAdd,
  onRemove,
  onRename,
  onAssignImage,
  onClearImage,
  onPreviewImage,
  onUseAsGenerationInput,
  onSplitFromAsset,
  onSourceAssetImageClick,
}: Props) {
  return (
    <StoryboardRoleAssetStrip
      assets={assets}
      readOnly={readOnly}
      busyId={busyId}
      highlightAssetId={highlightInputId}
      namePlaceholder="参考图名"
      addLabel="添加参考图"
      removeAriaLabel="删除参考图"
      resolveDisplaySrc={(asset) => resolveAssetSetSourceAssetDisplaySrc(asset as AssetSetSourceAsset)}
      onAdd={onAdd}
      onRemove={onRemove}
      onRename={onRename}
      onAssignImage={onAssignImage}
      onClearImage={onClearImage}
      onPreviewImage={onPreviewImage}
      onUseAsGenerationInput={
        onUseAsGenerationInput
          ? (asset) => onUseAsGenerationInput(asset as AssetSetSourceAsset)
          : undefined
      }
      onSplitFromAsset={
        onSplitFromAsset ? (asset) => onSplitFromAsset(asset as AssetSetSourceAsset) : undefined
      }
      onAssetImageClick={(asset) =>
        onSourceAssetImageClick?.(asset as AssetSetSourceAsset) ?? false
      }
    />
  );
}
