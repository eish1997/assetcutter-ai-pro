/**
 * 预览子系统类型：工作流大图 / 未来 3D、点云、3DGS、视频等统一由此扩展。
 */

/** 大图壳 `ImagePreviewOverlay` 的视图布局（平面为内联，其余多为独立 WebGL） */
export type ImagePreviewLayoutMode = 'flat' | 'pano' | 'model3d' | 'heightfield';

/** 当前已接入注册表的图片类模式（平面仍由内联实现，不走路由懒加载） */
export type RegisteredImagePreviewMode =
  | 'image.flat'
  | 'image.equirect'
  | 'image.model3d'
  | 'image.heightfield';

/** 未来可扩展为 model.glb | pointcloud | splat | video 等 */
export type PreviewMode = RegisteredImagePreviewMode | (string & {});

export type PreviewImagePayload = {
  kind: 'image';
  /** 已解析、当前站点可达的地址（与 workflowSafeImgSrc 等配合） */
  src: string;
};

/** 描述「当前要预览什么」；壳层只读 policy，具体渲染由 registry → Viewer 完成 */
export type PreviewDescriptor = {
  mode: PreviewMode;
  payload: PreviewImagePayload;
};

/**
 * Viewer 对全局输入的声明，供 PreviewShell / 父级做滚轮、快捷键仲裁（逐步接入）。
 * - captureGlobalWheel：为 true 时父级应跳过默认「切图 / 切版本」滚轮逻辑
 */
export type PreviewViewerInputPolicy = {
  captureGlobalWheel: boolean;
};

export function previewPolicyForMode(mode: PreviewMode): PreviewViewerInputPolicy {
  if (mode === 'image.equirect' || mode === 'image.model3d' || mode === 'image.heightfield') {
    return { captureGlobalWheel: true };
  }
  return { captureGlobalWheel: false };
}

export function isImagePreviewDescriptor(d: PreviewDescriptor): d is PreviewDescriptor & { payload: PreviewImagePayload } {
  return d.payload.kind === 'image';
}
