import { detectWebGpuSupport } from './capabilityDetector';
import {
  createInitialDebugState,
  markActiveBackend,
  markDebugError,
} from './debugState';
import type {
  PreferredBackend,
  RenderBackend,
  RenderCoreDebugState,
  RenderHost,
  RenderHostOptions,
  RendererAdapter,
} from './types';
import { createWebGlRendererAdapter } from './webglRendererAdapter';
import { createWebGpuRendererAdapter } from './webgpuRendererAdapter';

function resolvePreferred(preferred: PreferredBackend | undefined): PreferredBackend {
  return preferred ?? 'webgpu';
}

export function createRenderHost(options: RenderHostOptions = {}): RenderHost {
  const preferredBackend = resolvePreferred(options.preferredBackend);
  const fallbackBackend = options.fallbackBackend ?? 'webgl';
  let debug: RenderCoreDebugState = createInitialDebugState(preferredBackend);
  let adapter: RendererAdapter | null = null;
  let disposed = false;

  const emit = (
    type: 'init' | 'fallback' | 'device-lost' | 'context-lost' | 'error' | 'dispose',
    message?: string
  ) => {
    options.onDebugEvent?.({ type, message, state: { ...debug } });
  };

  const dropAdapter = () => {
    adapter?.dispose();
    adapter = null;
  };

  const initAdapter = async (backend: RenderBackend, reasonIfFallback?: string) => {
    const factory =
      backend === 'webgpu'
        ? options.createWebGpuAdapter ?? createWebGpuRendererAdapter
        : options.createWebGlAdapter ?? createWebGlRendererAdapter;

    const next = factory();
    await next.init({
      canvas: options.canvas,
      container: options.container,
      ...(options.visual ?? {}),
    });

    adapter = next;
    debug = markActiveBackend(debug, backend, {
      fallbackUsed: Boolean(reasonIfFallback),
      fallbackReason: reasonIfFallback,
    });
    emit(reasonIfFallback ? 'fallback' : 'init', reasonIfFallback);
  };

  const host: RenderHost = {
    get backend() {
      return adapter?.backend ?? null;
    },
    get fallbackUsed() {
      return debug.fallbackUsed;
    },
    get fallbackReason() {
      return debug.fallbackReason;
    },

    async init(): Promise<void> {
      if (disposed) throw new Error('RenderHost disposed');
      if (adapter) return;

      // PMREM / classic WebGLRenderer callers must never spin up WebGPU first:
      // workbench thumbnail storms would init+dispose WebGPU per card and can black-screen the GPU.
      if (options.requireClassicWebGl) {
        if (fallbackBackend !== 'webgl' && preferredBackend !== 'webgl') {
          throw new Error('classic WebGL required but fallbackBackend is none');
        }
        await initAdapter(
          'webgl',
          preferredBackend === 'webgl' ? undefined : 'classic-webgl-required'
        );
        return;
      }

      const wantWebGpu =
        preferredBackend === 'webgpu' || preferredBackend === 'auto';
      const wantWebGlOnly = preferredBackend === 'webgl';

      if (wantWebGlOnly) {
        await initAdapter('webgl');
        return;
      }

      if (wantWebGpu) {
        const detect = options.detectWebGpuSupport ?? detectWebGpuSupport;
        const capability = await detect();
        if (capability.supported) {
          try {
            await initAdapter('webgpu');
            return;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            debug = markDebugError(debug, message);
            emit('error', message);
            if (fallbackBackend !== 'webgl') {
              throw err;
            }
            dropAdapter();
            await initAdapter('webgl', `webgpu-init-failed:${message}`);
            return;
          }
        }

        if (fallbackBackend === 'webgl') {
          await initAdapter(
            'webgl',
            capability.reason ? `webgpu-unsupported:${capability.reason}` : 'webgpu-unsupported'
          );
          return;
        }

        const reason = capability.reason ?? 'webgpu-unsupported';
        debug = markDebugError(debug, reason);
        throw new Error(`WebGPU unavailable and fallback disabled: ${reason}`);
      }
    },

    resize(width: number, height: number, pixelRatio: number): void {
      adapter?.resize(width, height, pixelRatio);
    },

    render(scene: unknown, camera: unknown): void {
      adapter?.render(scene, camera);
    },

    capture(mimeType?: string, quality?: number): string | null {
      return adapter?.capture(mimeType, quality) ?? null;
    },

    dispose(): void {
      disposed = true;
      adapter?.dispose();
      adapter = null;
      emit('dispose');
    },

    getDebugState(): RenderCoreDebugState {
      return { ...debug };
    },

    getAdapter(): RendererAdapter | null {
      return adapter;
    },

    getRawRenderer(): unknown | null {
      return adapter?.renderer ?? null;
    },

    getDomElement(): HTMLCanvasElement | null {
      try {
        return adapter?.domElement ?? null;
      } catch {
        return null;
      }
    },
  };

  return host;
}
