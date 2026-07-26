import * as THREE from 'three';
import { captureCanvasDataUrl } from './capturePipeline';
import type {
  RendererAdapter,
  RendererAdapterInitInput,
  RendererVisualOptions,
} from './types';

type MutableRenderer = THREE.WebGLRenderer & {
  outputColorSpace?: unknown;
  toneMapping?: unknown;
  toneMappingExposure?: number;
};

function applyVisual(renderer: MutableRenderer, opts: RendererVisualOptions): void {
  if (opts.outputColorSpace !== undefined) {
    renderer.outputColorSpace = opts.outputColorSpace as THREE.ColorSpace;
  }
  if (opts.toneMapping !== undefined) {
    renderer.toneMapping = opts.toneMapping as THREE.ToneMapping;
  }
  if (typeof opts.toneMappingExposure === 'number') {
    renderer.toneMappingExposure = opts.toneMappingExposure;
  }
  if (typeof opts.clearColor === 'number') {
    const alpha = typeof opts.clearAlpha === 'number' ? opts.clearAlpha : 1;
    renderer.setClearColor(opts.clearColor, alpha);
  } else if (typeof opts.clearAlpha === 'number') {
    renderer.setClearAlpha(opts.clearAlpha);
  }
}

export function createWebGlRendererAdapter(): RendererAdapter {
  let renderer: MutableRenderer | null = null;
  let disposed = false;

  const adapter: RendererAdapter = {
    backend: 'webgl',
    get renderer() {
      return renderer;
    },
    get domElement() {
      if (!renderer) throw new Error('WebGL adapter not initialized');
      return renderer.domElement;
    },

    async init(input: RendererAdapterInitInput): Promise<void> {
      if (disposed) throw new Error('WebGL adapter disposed');
      if (renderer) return;

      const next = new THREE.WebGLRenderer({
        canvas: input.canvas,
        antialias: input.antialias ?? true,
        alpha: input.alpha ?? false,
        preserveDrawingBuffer: input.preserveDrawingBuffer ?? false,
      }) as MutableRenderer;

      applyVisual(next, input);

      if (input.container && next.domElement.parentElement !== input.container) {
        input.container.appendChild(next.domElement);
      }

      renderer = next;
    },

    applyVisualOptions(opts: RendererVisualOptions): void {
      if (!renderer) throw new Error('WebGL adapter not initialized');
      applyVisual(renderer, opts);
    },

    resize(width: number, height: number, pixelRatio: number): void {
      if (!renderer) throw new Error('WebGL adapter not initialized');
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
    },

    render(scene: unknown, camera: unknown): void {
      if (!renderer) throw new Error('WebGL adapter not initialized');
      renderer.render(scene as THREE.Scene, camera as THREE.Camera);
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
