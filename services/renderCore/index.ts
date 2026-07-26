export { detectWebGpuSupport } from './capabilityDetector';
export type { WebGpuCapabilityResult } from './capabilityDetector';
export { captureCanvasDataUrl } from './capturePipeline';
export {
  createInitialDebugState,
  markActiveBackend,
  markDebugError,
} from './debugState';
export { createRenderHost } from './renderHost';
export { createWebGlRendererAdapter } from './webglRendererAdapter';
export { createWebGpuRendererAdapter } from './webgpuRendererAdapter';
export type {
  PreferredBackend,
  RenderBackend,
  RenderCoreDebugEvent,
  RenderCoreDebugState,
  RendererAdapter,
  RendererAdapterInitInput,
  RendererVisualOptions,
  RenderHost,
  RenderHostOptions,
} from './types';
