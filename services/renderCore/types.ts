/** Shared types for WebGPU-first render core (parity adapters). */

export type RenderBackend = 'webgpu' | 'webgl';

export type PreferredBackend = 'webgpu' | 'webgl' | 'auto';

export type RendererVisualOptions = {
  antialias?: boolean;
  alpha?: boolean;
  preserveDrawingBuffer?: boolean;
  /** THREE.ColorSpace value */
  outputColorSpace?: unknown;
  /** THREE.ToneMapping value */
  toneMapping?: unknown;
  toneMappingExposure?: number;
  clearColor?: number;
  clearAlpha?: number;
};

export type RendererAdapterInitInput = RendererVisualOptions & {
  canvas?: HTMLCanvasElement;
  container?: HTMLElement;
};

export type RendererAdapter = {
  backend: RenderBackend;
  /** Underlying Three renderer instance */
  renderer: unknown;
  domElement: HTMLCanvasElement;
  init(input: RendererAdapterInitInput): Promise<void>;
  applyVisualOptions(opts: RendererVisualOptions): void;
  resize(width: number, height: number, pixelRatio: number): void;
  render(scene: unknown, camera: unknown): void;
  capture(mimeType?: string, quality?: number): string | null;
  dispose(): void;
};

export type RenderCoreDebugState = {
  preferredBackend: PreferredBackend;
  activeBackend: RenderBackend | null;
  fallbackUsed: boolean;
  fallbackReason?: string;
  deviceLost?: boolean;
  contextLost?: boolean;
  lastInitAt?: number;
  lastError?: string;
};

export type RenderCoreDebugEvent = {
  type: 'init' | 'fallback' | 'device-lost' | 'context-lost' | 'error' | 'dispose';
  message?: string;
  state: RenderCoreDebugState;
};

export type RenderHostOptions = {
  preferredBackend?: PreferredBackend;
  fallbackBackend?: 'webgl' | 'none';
  visual?: RendererVisualOptions;
  canvas?: HTMLCanvasElement;
  container?: HTMLElement;
  /**
   * When true, WebGPU success is discarded if the live renderer is not a classic
   * `THREE.WebGLRenderer` (e.g. PMREM / HDR stage still requires WebGL in r182).
   * Falls back to WebGL with reason `classic-webgl-required`.
   */
  requireClassicWebGl?: boolean;
  onDebugEvent?: (event: RenderCoreDebugEvent) => void;
  /** Test / DI hooks */
  detectWebGpuSupport?: () => Promise<{ supported: boolean; reason?: string }>;
  createWebGpuAdapter?: () => RendererAdapter;
  createWebGlAdapter?: () => RendererAdapter;
};

export type RenderHost = {
  backend: RenderBackend | null;
  fallbackUsed: boolean;
  fallbackReason?: string;
  init(): Promise<void>;
  resize(width: number, height: number, pixelRatio: number): void;
  render(scene: unknown, camera: unknown): void;
  capture(mimeType?: string, quality?: number): string | null;
  dispose(): void;
  getDebugState(): RenderCoreDebugState;
  getAdapter(): RendererAdapter | null;
  getRawRenderer(): unknown | null;
  getDomElement(): HTMLCanvasElement | null;
};
