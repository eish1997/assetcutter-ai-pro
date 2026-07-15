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
const MODEL_3D_DISPLAY_MODES: Array<{ key: Model3DDisplayMode; label: string; title: string }> = [
  { key: 'material', label: '材质', title: '使用模型原始材质' },
  { key: 'clay', label: '素模', title: '灰模预览，便于观察形体' },
  { key: 'wire', label: '线框', title: '线框预览，便于检查网格' },
  { key: 'normal', label: '法线', title: '法线色预览' },
];

type Props = {
  variant: WorkflowAssetVariant;
  model3dDisplayMode?: Model3DDisplayMode;
  onModel3dDisplayModeChange?: (mode: Model3DDisplayMode) => void;
  onAddToComposeInput?: (text: string) => void;
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

function variantReferenceText(variant: WorkflowAssetVariant, url: string, filename: string): string {
  const lines = [
    `[${variant.kind.toUpperCase()}资产] ${variant.label || variant.id}`,
    `版本: ${variant.id}`,
    `文件: ${filename}`,
  ];
  if (url) lines.push(`链接: ${url}`);
  if (variant.objectKey) lines.push(`objectKey: ${variant.objectKey}`);
  if (variant.companionKey) lines.push(`companionKey: ${variant.companionKey}`);
  return lines.join('\n');
}

function MediaActionBar({
  variant,
  url,
  model3dDisplayMode,
  onModel3dDisplayModeChange,
  onAddToComposeInput,
}: {
  variant: WorkflowAssetVariant;
  url: string;
  model3dDisplayMode: Model3DDisplayMode;
  onModel3dDisplayModeChange?: (mode: Model3DDisplayMode) => void;
  onAddToComposeInput?: (text: string) => void;
}) {
  const filename = useMemo(() => inferFileName(variant), [variant]);
  const copy = useCallback(() => copyToClipboard(url || variant.objectKey || variant.companionKey || variant.id), [url, variant]);
  const download = useCallback(() => openDownload(url, filename), [filename, url]);
  const addReference = useCallback(() => {
    onAddToComposeInput?.(variantReferenceText(variant, url, filename));
  }, [filename, onAddToComposeInput, url, variant]);

  return (
    <div className="pointer-events-auto absolute left-4 right-4 top-4 z-10 flex items-start justify-between gap-3">
      <div className="min-w-0 rounded-xl border border-white/10 bg-[#0f0f12]/90 px-3 py-2 shadow-xl ring-1 ring-white/[0.05] backdrop-blur-md">
        <p className="truncate text-[13px] font-bold text-gray-100">{variant.label || variant.id}</p>
        <p className="mt-0.5 truncate text-[10px] text-gray-500">
          {variant.kind.toUpperCase()} · {filename}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1.5 rounded-xl border border-white/10 bg-[#0f0f12]/90 p-1.5 shadow-xl ring-1 ring-white/[0.05] backdrop-blur-md">
        {variant.kind === 'model3d' && onModel3dDisplayModeChange ? (
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30 p-0.5">
            {MODEL_3D_DISPLAY_MODES.map((mode) => (
              <button
                key={mode.key}
                type="button"
                title={mode.title}
                aria-pressed={model3dDisplayMode === mode.key}
                onClick={() => onModel3dDisplayModeChange(mode.key)}
                className={`h-7 rounded-md px-2 text-[10px] font-bold transition-colors ${
                  model3dDisplayMode === mode.key
                    ? 'bg-white text-black'
                    : 'text-white/65 hover:bg-white/10 hover:text-white'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          onClick={copy}
          className="h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] font-bold text-gray-300 hover:bg-white/[0.08] hover:text-white"
        >
          复制链接
        </button>
        {onAddToComposeInput ? (
          <button
            type="button"
            onClick={addReference}
            className="h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] font-bold text-gray-300 hover:bg-white/[0.08] hover:text-white"
          >
            加入输入框
          </button>
        ) : null}
        <button
          type="button"
          disabled={!url}
          onClick={download}
          className="h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] font-bold text-gray-300 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          下载
        </button>
      </div>
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

function ViewerSurface({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`min-h-0 flex-1 overflow-hidden ${className}`}>{children}</div>;
}

function VideoAssetViewer({ url }: { url: string }) {
  return (
    <ViewerSurface className="flex items-center justify-center bg-black/20 p-4">
      <video src={url} controls className="max-h-full max-w-full rounded-lg shadow-2xl" />
    </ViewerSurface>
  );
}

function AudioAssetViewer({ url }: { url: string }) {
  return (
    <ViewerSurface className="flex flex-col items-center justify-center p-6">
      <div className="mx-auto w-full max-w-3xl rounded-xl border border-white/10 bg-[#101114]/80 px-6 py-8 shadow-xl">
        <AudioWave />
        <audio src={url} controls className="mx-auto mt-6 w-full max-w-2xl" />
      </div>
    </ViewerSurface>
  );
}

function Model3DAssetViewer({
  variant,
  url,
  model3dDisplayMode,
}: {
  variant: WorkflowAssetVariant;
  url: string;
  model3dDisplayMode: Model3DDisplayMode;
}) {
  if (!LazyImageModel3DViewer) return <MissingMedia variant={variant} />;
  return (
    <ViewerSurface>
      <PreviewViewerErrorBoundary mode="image.model3d" label="3D">
        <Suspense fallback={<PreviewViewerFallback label="3D 模块加载中..." />}>
          <LazyImageModel3DViewer
            imageSrc={variant.posterUrl || ''}
            modelSrc={url}
            modelFileName={inferFileName(variant)}
            model3dDisplayMode={model3dDisplayMode}
            className="h-full w-full min-h-0"
          />
        </Suspense>
      </PreviewViewerErrorBoundary>
    </ViewerSurface>
  );
}

function FileAssetViewer({ url }: { url: string }) {
  return (
    <ViewerSurface className="flex items-center justify-center p-6">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-[12px] font-bold text-gray-200 hover:bg-white/[0.08]"
      >
        打开文件
      </a>
    </ViewerSurface>
  );
}

export const AssetMediaPreviewCenter: React.FC<Props> = ({
  variant,
  model3dDisplayMode = 'material',
  onModel3dDisplayModeChange,
  onAddToComposeInput,
}) => {
  const url = clean(variant.url);
  const modelUrl = variant.kind === 'model3d' ? pickModelUrl(variant) : '';
  const usableUrl = variant.kind === 'model3d' ? modelUrl : url;

  return (
    <div
      className="pointer-events-auto relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-image-preview-no-wheel
    >
      <MediaActionBar
        variant={variant}
        url={usableUrl}
        model3dDisplayMode={model3dDisplayMode}
        onModel3dDisplayModeChange={onModel3dDisplayModeChange}
        onAddToComposeInput={onAddToComposeInput}
      />
      {variant.kind === 'video' && usableUrl ? (
        <VideoAssetViewer url={usableUrl} />
      ) : variant.kind === 'audio' && usableUrl ? (
        <AudioAssetViewer url={usableUrl} />
      ) : variant.kind === 'model3d' && usableUrl ? (
        <Model3DAssetViewer variant={variant} url={usableUrl} model3dDisplayMode={model3dDisplayMode} />
      ) : usableUrl ? (
        <FileAssetViewer url={usableUrl} />
      ) : (
        <MissingMedia variant={variant} />
      )}
    </div>
  );
};

export default AssetMediaPreviewCenter;
