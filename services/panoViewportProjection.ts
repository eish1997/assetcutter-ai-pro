/**
 * 与 `captureViewDataUrl` 同一时刻的相机/缓冲尺寸，用于异步贴回时从快照像素反投到等距柱 UV。
 */
export type PanoLocalReprojectSnapshot = {
  bufferW: number;
  bufferH: number;
  /** 垂直 FOV（度），与 Three.js PerspectiveCamera 一致 */
  fovDeg: number;
  aspect: number;
  cameraPosition: [number, number, number];
  cameraQuaternion: [number, number, number, number];
};

/**
 * 全景 WebGL 视口与等距柱状纹理归一化坐标 (u,v∈[0,1]) 的互转约定，
 * 与 `EquirectangularPanoramaCanvas` 内 Three.js 球面与 OrbitControls 一致。
 */
export type PanoramaViewportProjection = {
  /** 视口 client 坐标 → 纹理归一化；未打到球面返回 null */
  clientToEquirectNorm: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** 纹理归一化 → 视口 client；在相机背后等返回 null */
  equirectNormToClient: (u: number, v: number) => { x: number; y: number } | null;
  /**
   * 与 `clientToEquirectNorm`、`captureViewDataUrl` 使用同一 WebGL canvas 的 CSS 像素框归一化 0~1。
   * 全景裁切 / 局部重绘框选须用此方法（勿用外层叠层 div），避免亚像素或布局差导致贴回错位。
   */
  clientToSnapshotNorm: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** `clientToSnapshotNorm` 所用的 canvas 包围盒（client 坐标） */
  getSnapshotClientRect: () => DOMRect | null;
  /** 与 OrbitControls 阻尼同一节拍，用于叠层重投影 */
  subscribeAnimation: (fn: () => void) => () => void;
  /** 当前透视画面（与所见一致） */
  captureViewDataUrl: (mime?: string, quality?: number) => string | null;
  /** 当前帧相机状态 + 渲染缓冲尺寸（与下一帧 `toDataURL` 像素对齐） */
  getReprojectSnapshot: () => PanoLocalReprojectSnapshot | null;
  /**
   * 恢复局部重绘记录时的相机姿态/FOV，清零 Orbit 阻尼增量并 **同步 render 一帧**，
   * 以便立刻 `captureViewDataUrl` 与记录时的屏幕框对齐。
   */
  applyReprojectSnapshot: (snap: PanoLocalReprojectSnapshot) => void;
  /** 默认朝向（初始位姿 + FOV≈70），双击全景画布调用 */
  resetViewToDefault: () => void;
};
