import React, { Suspense, useEffect, useMemo } from 'react';

import type { WorkflowAssetVariant, WorkflowModel3dViewState } from '../../types';
import type { WorkflowModelPbrEditDoc } from '../../services/workflowModelPbrEdits';
import {
  getLazyImagePreviewViewer,
  PreviewViewerErrorBoundary,
  PreviewViewerFallback,
  type ImagePreviewWebCaptureApi,
  type Model3DDisplayMode,
} from '../preview';
import AppIcon from '../ui/AppIcon';

const LazyImageModel3DViewer = getLazyImagePreviewViewer('image.model3d');

type Props = {
  variant: WorkflowAssetVariant;
  assetId?: string;
  model3dPbrEditDoc?: WorkflowModelPbrEditDoc | null;
  model3dDisplayMode?: Model3DDisplayMode;
  model3dResetViewNonce?: number;
  model3dShowGrid?: boolean;
  model3dBackfaceCulling?: boolean;
  capturePreviewNonce?: number;
  /** 右侧缩略图条宽度，传给 3D Viewer 做 PBR 面板避让 */
  uiRightInset?: string;
  resolvePbrTextureAssetSrc?: (assetId: string) => string;
  onAddToComposeInput?: (text: string) => void;
  /** 纯 model3d centerSlot：注册截取当前 WebGL 画面 */
  onWebPreviewCaptureApiChange?: (api: ImagePreviewWebCaptureApi | null) => void;
  onModel3dViewDirty?: () => void;
  model3dViewState?: WorkflowModel3dViewState | null;
  onModel3dViewStateChange?: (state: WorkflowModel3dViewState, assetId?: string) => void;
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
  const formatHint = variant.kind === 'model3d' ? clean(variant.modelFormats?.[0]) : '';
  const ext =
    formatHint === 'glb' || formatHint === 'gltf' || formatHint === 'fbx' || formatHint === 'obj'
      ? formatHint
      : variant.kind === 'audio'
        ? 'mp3'
        : variant.kind === 'video'
          ? 'mp4'
          : 'asset';
  if (fromUrl && /\.[a-z0-9]{2,8}$/i.test(fromUrl)) return fromUrl;
  return `${label}.${ext}`;
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
        {(variant.modelCompanionKeys || []).map((key, index) =>
          key ? (
            <p key={`${key}:${index}`} className="max-w-[32rem] truncate">
              modelKey {index + 1}: {key}
            </p>
          ) : null
        )}
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

function downloadDataUrl(dataUrl: string, filename: string) {
  if (!dataUrl || typeof document === 'undefined') return;
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.rel = 'noopener';
  a.click();
}

function VideoAssetViewer({
  url,
  capturePreviewNonce,
  filename,
}: {
  url: string;
  capturePreviewNonce?: number;
  filename: string;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  React.useEffect(() => {
    if (!capturePreviewNonce) return;
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    downloadDataUrl(canvas.toDataURL('image/png'), `${filename.replace(/\.[^.]+$/, '') || 'video-frame'}.png`);
  }, [capturePreviewNonce, filename]);

  return (
    <ViewerSurface className="flex items-center justify-center bg-black/20 p-4">
      <video ref={videoRef} src={url} controls className="max-h-full max-w-full rounded-lg shadow-2xl" />
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
  assetId,
  model3dPbrEditDoc,
  url,
  model3dDisplayMode,
  model3dResetViewNonce,
  model3dShowGrid,
  model3dBackfaceCulling,
  capturePreviewNonce,
  uiRightInset,
  resolvePbrTextureAssetSrc,
  onWebPreviewCaptureApiChange,
  onModel3dViewDirty,
  model3dViewState,
  onModel3dViewStateChange,
}: {
  variant: WorkflowAssetVariant;
  assetId?: string;
  model3dPbrEditDoc?: WorkflowModelPbrEditDoc | null;
  url: string;
  model3dDisplayMode: Model3DDisplayMode;
  model3dResetViewNonce?: number;
  model3dShowGrid?: boolean;
  model3dBackfaceCulling?: boolean;
  capturePreviewNonce?: number;
  uiRightInset?: string;
  resolvePbrTextureAssetSrc?: (assetId: string) => string;
  onWebPreviewCaptureApiChange?: (api: ImagePreviewWebCaptureApi | null) => void;
  onModel3dViewDirty?: () => void;
  model3dViewState?: WorkflowModel3dViewState | null;
  onModel3dViewStateChange?: (state: WorkflowModel3dViewState, assetId?: string) => void;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const viewerCaptureRef = React.useRef<ImagePreviewWebCaptureApi | null>(null);

  const captureApi = useMemo<ImagePreviewWebCaptureApi>(
    () => ({
      captureCurrentViewAsDataUrl: () => {
        const fromViewer = viewerCaptureRef.current?.captureCurrentViewAsDataUrl();
        if (fromViewer?.startsWith('data:image/')) return fromViewer;
        const canvas = hostRef.current?.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 2 || canvas.height < 2) return null;
        try {
          return canvas.toDataURL('image/png');
        } catch {
          return null;
        }
      },
    }),
    []
  );

  useEffect(() => {
    if (!onWebPreviewCaptureApiChange) return;
    onWebPreviewCaptureApiChange(captureApi);
    return () => onWebPreviewCaptureApiChange(null);
  }, [captureApi, onWebPreviewCaptureApiChange]);

  React.useEffect(() => {
    if (!capturePreviewNonce) return;
    const dataUrl = captureApi.captureCurrentViewAsDataUrl();
    if (!dataUrl) return;
    downloadDataUrl(dataUrl, `${inferFileName(variant).replace(/\.[^.]+$/, '') || 'model-view'}.png`);
  }, [captureApi, capturePreviewNonce, variant]);

  if (!LazyImageModel3DViewer) return <MissingMedia variant={variant} />;
  return (
    <ViewerSurface>
      <PreviewViewerErrorBoundary mode="image.model3d" label="3D">
        <Suspense fallback={<PreviewViewerFallback label="3D 模块加载中..." />}>
          <div ref={hostRef} className="h-full w-full min-h-0">
            <LazyImageModel3DViewer
              imageSrc={variant.posterUrl || ''}
              modelSrc={url}
              model3dAssetId={assetId}
              model3dVariantId={variant.id}
              model3dModelKey={variant.modelCompanionKeys?.[0] || variant.id || url}
              model3dPbrEditDoc={model3dPbrEditDoc}
              modelFileName={inferFileName(variant)}
              model3dDisplayMode={model3dDisplayMode}
              model3dResetViewNonce={model3dResetViewNonce}
              model3dShowGrid={model3dShowGrid}
              model3dBackfaceCulling={model3dBackfaceCulling}
              onModel3dViewDirty={onModel3dViewDirty}
              model3dViewState={model3dViewState}
              onModel3dViewStateChange={onModel3dViewStateChange}
              onModel3dCaptureApiChange={(api) => {
                viewerCaptureRef.current = api;
              }}
              uiRightInset={uiRightInset}
              resolvePbrTextureAssetSrc={resolvePbrTextureAssetSrc}
              className="h-full w-full min-h-0"
            />
          </div>
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
  assetId,
  model3dPbrEditDoc,
  model3dDisplayMode: model3dDisplayModeProp,
  model3dResetViewNonce = 0,
  model3dShowGrid = true,
  model3dBackfaceCulling = true,
  capturePreviewNonce = 0,
  uiRightInset,
  resolvePbrTextureAssetSrc,
  onWebPreviewCaptureApiChange,
  onModel3dViewDirty,
  model3dViewState,
  onModel3dViewStateChange,
}) => {
  const url = clean(variant.url);
  const modelUrl = variant.kind === 'model3d' ? pickModelUrl(variant) : '';
  const usableUrl = variant.kind === 'model3d' ? modelUrl : url;
  const resolvedModel3dDisplayMode: Model3DDisplayMode = model3dDisplayModeProp ?? 'material';
  const filename = inferFileName(variant);

  return (
    <div
      className="pointer-events-auto relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-image-preview-no-wheel
    >
      {variant.kind === 'video' && usableUrl ? (
        <VideoAssetViewer url={usableUrl} filename={filename} capturePreviewNonce={capturePreviewNonce} />
      ) : variant.kind === 'audio' && usableUrl ? (
        <AudioAssetViewer url={usableUrl} />
      ) : variant.kind === 'model3d' && usableUrl ? (
        <Model3DAssetViewer
          key={`${assetId || 'asset'}:${variant.id}`}
          variant={variant}
          assetId={assetId}
          model3dPbrEditDoc={model3dPbrEditDoc}
          url={usableUrl}
          model3dDisplayMode={resolvedModel3dDisplayMode}
          model3dResetViewNonce={model3dResetViewNonce}
          model3dShowGrid={model3dShowGrid}
          model3dBackfaceCulling={model3dBackfaceCulling}
          capturePreviewNonce={capturePreviewNonce}
          uiRightInset={uiRightInset}
          resolvePbrTextureAssetSrc={resolvePbrTextureAssetSrc}
          onWebPreviewCaptureApiChange={onWebPreviewCaptureApiChange}
          onModel3dViewDirty={onModel3dViewDirty}
          model3dViewState={model3dViewState}
          onModel3dViewStateChange={onModel3dViewStateChange}
        />
      ) : usableUrl ? (
        <FileAssetViewer url={usableUrl} />
      ) : (
        <MissingMedia variant={variant} />
      )}
    </div>
  );
};

export default AssetMediaPreviewCenter;
