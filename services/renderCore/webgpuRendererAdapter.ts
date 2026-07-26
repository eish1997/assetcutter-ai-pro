import type {
  RendererAdapter,
  RendererAdapterInitInput,
  RendererVisualOptions,
} from './types';
import { captureCanvasDataUrl } from './capturePipeline';

type WebGpuLikeRenderer = {
  domElement: HTMLCanvasElement;
  init: () => Promise<unknown>;
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
  setPixelRatio: (value: number) => void;
  render: (scene: unknown, camera: unknown) => void;
  dispose: () => void;
  outputColorSpace?: unknown;
  toneMapping?: unknown;
  toneMappingExposure?: number;
  setClearColor?: (color: number, alpha?: number) => void;
  setClearAlpha?: (alpha: number) => void;
};

function applyVisual(renderer: WebGpuLikeRenderer, opts: RendererVisualOptions): void {
  if (opts.outputColorSpace !== undefined) {
    renderer.outputColorSpace = opts.outputColorSpace;
  }
  if (opts.toneMapping !== undefined) {
    renderer.toneMapping = opts.toneMapping;
  }
  if (typeof opts.toneMappingExposure === 'number') {
    renderer.toneMappingExposure = opts.toneMappingExposure;
  }
  if (typeof opts.clearColor === 'number' && typeof renderer.setClearColor === 'function') {
    const alpha = typeof opts.clearAlpha === 'number' ? opts.clearAlpha : 1;
    renderer.setClearColor(opts.clearColor, alpha);
  } else if (typeof opts.clearAlpha === 'number' && typeof renderer.setClearAlpha === 'function') {
    renderer.setClearAlpha(opts.clearAlpha);
  }
}

export function createWebGpuRendererAdapter(): RendererAdapter {
  let renderer: WebGpuLikeRenderer | null = null;
  let disposed = false;

  const adapter: RendererAdapter = {
    backend: 'webgpu',
    get renderer() {
      return renderer;
    },
    get domElement() {
      if (!renderer) throw new Error('WebGPU adapter not initialized');
      return renderer.domElement;
    },

    async init(input: RendererAdapterInitInput): Promise<void> {
      if (disposed) throw new Error('WebGPU adapter disposed');
      if (renderer) return;

      const mod = await import('three/webgpu');
      const WebGPURenderer = mod.WebGPURenderer as new (params?: Record<string, unknown>) => WebGpuLikeRenderer;

      const next = new WebGPURenderer({
        canvas: input.canvas,
        antialias: input.antialias ?? true,
        alpha: input.alpha ?? false,
        // Three may ignore unknown flags; kept for parity with WebGL call sites.
        preserveDrawingBuffer: input.preserveDrawingBuffer ?? false,
      });

      await next.init();
      applyVisual(next, input);

      if (input.container && next.domElement.parentElement !== input.container) {
        input.container.appendChild(next.domElement);
      }

      renderer = next;
    },

    applyVisualOptions(opts: RendererVisualOptions): void {
      if (!renderer) throw new Error('WebGPU adapter not initialized');
      applyVisual(renderer, opts);
    },

    resize(width: number, height: number, pixelRatio: number): void {
      if (!renderer) throw new Error('WebGPU adapter not initialized');
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
    },

    render(scene: unknown, camera: unknown): void {
      if (!renderer) throw new Error('WebGPU adapter not initialized');
      renderer.render(scene, camera);
    },

    capture(mimeType?: string, quality?: number): string | null {
      if (!renderer) return null;
      return captureCanvasDataUrl(renderer.domElement, mimeType, quality);
    },

    dispose(): void {
      disposed = true;
      if (!renderer) return;
      const el = renderer.domElement;
      renderer.dispose();
      if (el.parentElement) el.parentElement.removeChild(el);
      renderer = null;
    },
  };

  return adapter;
}
