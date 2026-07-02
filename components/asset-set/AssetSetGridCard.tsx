import React, { memo, useMemo } from 'react';
import type { WorkflowAsset } from '../../types';
import {
  computeAssetSetStats,
  isWorkflowAssetSetAsset,
  assetSetPreviewImages,
  resolveAssetSetTitle,
} from '../../services/assetSet/assetSetAsset';

type Props = {
  asset: WorkflowAsset;
  className?: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  scene: '场景',
  character: '角色',
  prop: '道具',
};

function assetSetGridCardPropsEqual(prev: Props, next: Props): boolean {
  if (prev.className !== next.className) return false;
  if (prev.asset.id !== next.asset.id) return false;
  if (prev.asset.textTitle !== next.asset.textTitle) return false;
  return prev.asset.assetSet === next.asset.assetSet;
}

function AssetSetGridCardInner({ asset, className = '' }: Props) {
  const isSet = isWorkflowAssetSetAsset(asset);
  const stats = useMemo(() => {
    if (!isSet || !asset.assetSet) return null;
    return computeAssetSetStats(asset.assetSet);
  }, [asset.assetSet, isSet]);
  const previews = useMemo(
    () => (isSet ? assetSetPreviewImages(asset, 4) : []),
    [asset, isSet]
  );

  if (!isSet) return null;

  const title = resolveAssetSetTitle(asset);
  const category = asset.assetSet?.category ?? 'character';

  return (
    <div
      className={`relative flex h-full min-h-[10rem] w-full flex-col justify-between overflow-hidden bg-gradient-to-br from-[#101820] to-[#080c10] p-3 text-left ring-1 ring-inset ring-cyan-400/20 ${className}`}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-cyan-400/[0.08] blur-2xl" />

      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.45)]" />
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-cyan-200/80">
              资产集
            </p>
          </div>
          <p className="mt-1.5 text-[12px] font-bold leading-snug text-gray-50 line-clamp-2">
            {title}
          </p>
        </div>
        <span className="shrink-0 rounded-lg bg-cyan-500/10 px-2 py-1 text-[9px] font-black text-cyan-100 ring-1 ring-cyan-400/25">
          {CATEGORY_LABEL[category] ?? '角色'}
        </span>
      </div>

      <div className="relative mt-2 flex min-h-[5rem] flex-1 gap-1 overflow-hidden rounded-lg bg-black/35 p-1 ring-1 ring-white/[0.06]">
        {previews.length > 0 ? (
          previews.map((src, i) => (
            <div
              key={`${i}-${src.slice(0, 24)}`}
              className="min-w-0 flex-1 overflow-hidden rounded-md bg-black/40"
            >
              <img
                src={src}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
                loading="lazy"
                decoding="async"
              />
            </div>
          ))
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-[9px] text-gray-500">
            <span className="text-cyan-300/50">◫</span>
            <span>点击拆解资产</span>
          </div>
        )}
        {stats && stats.componentCount > previews.length && previews.length > 0 ? (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[7px] font-bold text-gray-300">
            +{stats.componentCount - previews.length}
          </span>
        ) : null}
      </div>

      <div className="relative mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[8px] text-gray-500">
        <span>{stats?.componentCount ?? 0} 组件</span>
        <span>{stats?.withViewsCount ?? 0} 已出图</span>
        <span>{stats?.withModelCount ?? 0} 已出模</span>
      </div>
    </div>
  );
}

export default memo(AssetSetGridCardInner, assetSetGridCardPropsEqual);
