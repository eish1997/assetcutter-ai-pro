import React, { Suspense, useCallback, useMemo } from 'react';

import type { WorkflowAssetVariant } from '../../types';
import {
  getLazyImagePreviewViewer,
  PreviewViewerErrorBoundary,
  PreviewViewerFallback,
  type Model3DDisplayMode,
} from '../preview';
import AppIcon from '../ui/AppIcon';

const LazyImageModel3DViewer = getLazyImagePreviewViewer('image.model3d');

type Props = {
  variant: WorkflowAssetVariant;
  model3dDisplayMode?: Model3DDisplayMode;
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickModelUrl(variant: WorkflowAssetVariant): string {
  const urls = (variant.modelUrls || []).map(clean).filter(Boolean);
  return urls[0] || clean(variant.url);
}

function inferFileName(variant: WorkflowAssetVariant): string {
  const label = clean(variant.label) || clean(variant.id) || variant.kind;
  const fromUrl = clean(variant.url || pickModelUrl(variant)).split('?')[0]?.split('#')[0]?.split('/').pop();
  return fromUrl || `${label}.${variant.kind === 'audio' ? 'mp3' : variant.kind === 'video' ? 'mp4' : 'asset'}`;
}

function copyToClipboard(text: string) {
  if (!text) return;
  void navigator.clipboard?.writeText(text);
}

function openDownload(url: string, filename: string) {
  if (!url || typeof document === 'undefined') return;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.click();
}

function MediaActionBar({ variant, url }: { variant: WorkflowAssetVariant; url: string }) {
  const filename = useMemo(() => inferFileName(variant), [variant]);
  const copy = useCallback(() => copyToClipboard(url || variant.objectKey || variant.companionKey || variant.id), [url, variant]);
  const download = useCallback(() => openDownload(url, filename), [filename, url]);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-gray-100">{variant.label || variant.id}</p>
        <p className="mt-0.5 truncate text-[10px] text-gray-500">
          {variant.kind.toUpperCase()} · {filename}
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] font-bold text-gray-300 hover:bg-white/[0.08] hover:text-white"
      >
        复制链接
      </button>
      <button
        type="button"
        disabled={!url}
        onClick={download}
        className="h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] font-bold text-gray-300 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
      >
        下载
      </button>
    </div>
  );
}

function MissingMedia({ variant }: { variant: WorkflowAssetVariant }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-gray-300">
        <AppIcon name={variant.kind === 'model3d' ? 'cube' : variant.kind === 'video' ? 'video' : 'package'} className="h-7 w-7" />
      </div>
      <p className="mt-3 text-[13px] font-bold text-gray-200">暂无可直接预览的文件链接</p>
      <p className="mt-1 max-w-md text-[11px] leading-5 text-gray-500">
        这个版本保留了资产记录，但当前只拿到了对象键或元信息。发布到云端或本地 companion 恢复后即可预览。
      </p>
      <div className="mt-3 max-w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-[10px] text-gray-400">
        {variant.objectKey ? <p className="max-w-[32rem] truncate">objectKey: {variant.objectKey}</p> : null}
        {variant.companionKey ? <p className="max-w-[32rem] truncate">companionKey: {variant.companionKey}</p> : null}
        <p className="max-w-[32rem] truncate">variant: {variant.id}</p>
      </div>
    </div>
  );
}

function AudioWave() {
  const bars = [34, 66, 42, 78, 50, 70, 38, 58, 46, 82, 40, 64, 32, 56, 74, 44];
  return (
    <div className="flex h-32 items-center justify-center gap-2">
      {bars.map((height, index) => (
        <span
          key={index}
          className="w-1.5 rounded-full bg-emerald-300/75"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

export const AssetMediaPreviewCenter: React.FC<Props> = ({ variant, model3dDisplayMode = 'material' }) => {
  const url = clean(variant.url);
  const modelUrl = variant.kind === 'model3d' ? pickModelUrl(variant) : '';
  const usableUrl = variant.kind === 'model3d' ? modelUrl : url;

  return (
    <div
      className="pointer-events-auto flex h-[min(82vh,56rem)] w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101114]/96 shadow-2xl"
      onMouseDownCapture={(e) => e.stopPropagation()}
      onPointerDownCapture={(e) => e.stopPropagation()}
      data-image-preview-no-wheel
    >
      <MediaActionBar variant={variant} url={usableUrl} />
      {variant.kind === 'video' && usableUrl ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black/60 p-4">
          <video src={usableUrl} controls className="max-h-full max-w-full rounded-xl" />
        </div>
      ) : variant.kind === 'audio' && usableUrl ? (
        <div className="flex min-h-0 flex-1 flex-col justify-center p-6">
          <AudioWave />
          <audio src={usableUrl} controls className="mx-auto mt-6 w-full max-w-2xl" />
        </div>
      ) : variant.kind === 'model3d' && usableUrl && LazyImageModel3DViewer ? (
        <div className="min-h-0 flex-1">
          <PreviewViewerErrorBoundary mode="image.model3d" label="3D">
            <Suspense fallback={<PreviewViewerFallback label="3D 模块加载中..." />}>
              <LazyImageModel3DViewer
                imageSrc={variant.posterUrl || ''}
                modelSrc={usableUrl}
                modelFileName={inferFileName(variant)}
                model3dDisplayMode={model3dDisplayMode}
                className="h-full w-full min-h-0"
              />
            </Suspense>
          </PreviewViewerErrorBoundary>
        </div>
      ) : usableUrl ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <a
            href={usableUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-[12px] font-bold text-gray-200 hover:bg-white/[0.08]"
          >
            打开文件
          </a>
        </div>
      ) : (
        <MissingMedia variant={variant} />
      )}
    </div>
  );
};

export default AssetMediaPreviewCenter;
