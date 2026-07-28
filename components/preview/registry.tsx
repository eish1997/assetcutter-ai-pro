/**
 * 预览 Viewer 注册表：按 mode 懒加载 React 组件，后续新增 3D / 点云 / 视频在此注册即可。
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { importWithChunkRetry } from '../../services/lazyImportWithRetry';
import type { WorkflowModelPbrEditDoc } from '../../services/workflowModelPbrEdits';
import type { WorkflowModel3dViewState } from '../../types';
import type { ImagePreviewWebCaptureApi } from './types';

/** 与懒加载 Viewer 对齐的最小 props（图片类）；其它类型可另建 registry 或扩展联合类型 */
export type Model3DDisplayMode = 'material' | 'clay' | 'wire' | 'normal';

export type LazyImagePreviewViewerProps = {
  imageSrc: string;
  modelSrc?: string;
  model3dAssetId?: string;
  model3dVariantId?: string;
  model3dModelKey?: string;
  model3dPbrEditDoc?: WorkflowModelPbrEditDoc | null;
  /** 与 blob: 本地 URL 配合，用于推断 .fbx/.obj 等格式 */
  modelFileName?: string;
  /** 3D 模型显示模式：由外层工具条控制 */
  model3dDisplayMode?: Model3DDisplayMode;
  /** 3D 模型：递增后重置相机视角 */
  model3dResetViewNonce?: number;
  /** 3D 模型：是否显示地面网格 */
  model3dShowGrid?: boolean;
  /** 3D 模型：true=背面消隐，false=双面显示。 */
  model3dBackfaceCulling?: boolean;
  /** 用户改变过相机/视角立方体时回调（用于关闭大图后刷新卡片预览图） */
  onModel3dViewDirty?: () => void;
  /** 上次保存的 3D 视口（相机 + 显示模式等） */
  model3dViewState?: WorkflowModel3dViewState | null;
  /** 视口变化时写回资产（仅卸载时；勿在 orbit end 调用） */
  onModel3dViewStateChange?: (state: WorkflowModel3dViewState, assetId?: string) => void;
  /**
   * 右侧 UI 避让宽度（如大图资产缩略图条）。PBR 面板会相对该 inset 左移，避免被遮挡。
   */
  uiRightInset?: string;
  /** 解析 PBR 正式贴图资产的当前预览 URL（companion hydrate 后的 blob / original） */
  resolvePbrTextureAssetSrc?: (assetId: string) => string;
  /** 关窗前截取当前帧（会先 render 再 toDataURL，比裸查 canvas 稳） */
  onModel3dCaptureApiChange?: (api: ImagePreviewWebCaptureApi | null) => void;
  className?: string;
  /** 全景：与上次卸载前相同 key 时换纹理后恢复相机位姿（如大图内切换版本，传 `innerLayoutStableKey`） */
  panoPreserveViewKey?: string;
  /**
   * 高度 3D 等：将控件 portal 到宿主元素（由 `ImagePreviewOverlay` 顶栏旁槽位或父级传入的 `heightfieldToolbarHostRef` 提供）。
   * 未传时 Viewer 使用内置浮层布局。
   */
  toolbarPortalEl?: HTMLElement | null;
};

type Loader = () => Promise<{ default: ComponentType<LazyImagePreviewViewerProps> }>;

const builtInImageLoaders: Record<string, Loader> = {
  'image.equirect': () => import('./viewers/ImageEquirectViewer'),
  'image.model3d': () => import('./viewers/ImageModel3DViewer'),
  'image.heightfield': () => import('./viewers/ImageHeightfieldViewer'),
};

const customImageLoaders = new Map<string, Loader>();

const lazyImageCache = new Map<string, LazyExoticComponent<ComponentType<LazyImagePreviewViewerProps>>>();

function getLoader(mode: string): Loader | undefined {
  return customImageLoaders.get(mode) ?? builtInImageLoaders[mode];
}

/**
 * 运行时注册图片类预览（例如插件在入口调用一次）。
 * 会清除该 mode 的 lazy 缓存，下次 getLazyImagePreviewViewer 重新创建。
 */
export function registerImagePreviewLoader(mode: string, loader: Loader): void {
  customImageLoaders.set(mode, loader);
  lazyImageCache.delete(mode);
}

/** Drop cached lazy() so the next get recreates the import promise (after chunk miss). */
export function resetLazyImagePreviewViewer(mode?: string): void {
  if (mode) {
    lazyImageCache.delete(mode);
    return;
  }
  lazyImageCache.clear();
}

/**
 * 返回该 mode 对应的懒加载组件；未注册则返回 null（由壳层走内联或其它分支）。
 */
export function getLazyImagePreviewViewer(
  mode: string
): LazyExoticComponent<ComponentType<LazyImagePreviewViewerProps>> | null {
  const load = getLoader(mode);
  if (!load) return null;
  let cached = lazyImageCache.get(mode);
  if (!cached) {
    cached = lazy(() => importWithChunkRetry(load));
    lazyImageCache.set(mode, cached);
  }
  return cached;
}
