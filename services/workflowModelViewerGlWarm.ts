import * as THREE from 'three';

import { createRenderHost, type RenderHost } from './renderCore';
import {
  configureWorkflowModelSoftShadows,
  createWorkflowModelViewerStageAsync,
  type WorkflowModelViewerStage,
} from './workflowModelViewerStage';

export type WorkflowModelViewerWarmRuntime = {
  renderHost: RenderHost;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  stage: WorkflowModelViewerStage;
};

type WarmSlot = {
  runtime: WorkflowModelViewerWarmRuntime;
  timer: ReturnType<typeof setTimeout> | null;
  generation: number;
};

/**
 * Keep last WebGL+PMREM warm briefly.
 * Canvas must stay in the document (hidden park) — removing it often loses the WebGL context,
 * and reusing a lost context makes the next open render an empty/transparent view.
 */
const WARM_HOLD_MS = 90_000;

let warm: WarmSlot | null = null;
let parkHost: HTMLDivElement | null = null;

function getParkHost(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (parkHost?.isConnected) return parkHost;
  parkHost = document.createElement('div');
  parkHost.setAttribute('data-workflow-model-viewer-gl-park', '1');
  parkHost.setAttribute('aria-hidden', 'true');
  parkHost.style.cssText =
    'position:fixed;left:-99999px;top:0;width:4px;height:4px;overflow:hidden;opacity:0;pointer-events:none;contain:strict;';
  document.body.appendChild(parkHost);
  return parkHost;
}

function parkCanvas(runtime: WorkflowModelViewerWarmRuntime): void {
  const canvas = runtime.renderHost.getDomElement();
  const host = getParkHost();
  if (canvas && host && canvas.parentElement !== host) {
    host.appendChild(canvas);
  }
}

function isRendererContextLost(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext() as WebGLRenderingContext | null;
    return Boolean(gl?.isContextLost?.());
  } catch {
    return true;
  }
}

/** Remove leftover model/ground from a recycled scene; keep stage lights + targets. */
function clearWarmSceneModels(scene: THREE.Scene, stage: WorkflowModelViewerStage): void {
  const keep = new Set<THREE.Object3D>([
    stage.hemi,
    stage.ambient,
    stage.keyLight,
    stage.fillLight,
    stage.rimLight,
    stage.bounceFill,
    stage.keyLight.target,
    stage.fillLight.target,
    stage.rimLight.target,
    stage.bounceFill.target,
  ]);
  for (const child of [...scene.children]) {
    if (!keep.has(child)) scene.remove(child);
  }
}

function disposeWarmSlot(slot: WarmSlot): void {
  if (slot.timer) {
    clearTimeout(slot.timer);
    slot.timer = null;
  }
  try {
    slot.runtime.stage.dispose();
  } catch {
    /* ignore */
  }
  try {
    slot.runtime.renderHost.dispose();
  } catch {
    /* ignore */
  }
}

/**
 * Acquire a WebGL runtime. Prefer recycling the last released slot (same PMREM/env).
 * Canvas is reparented into `container`.
 */
export async function acquireWorkflowModelViewerWarmRuntime(
  container: HTMLElement,
  options?: { signal?: AbortSignal; width?: number; height?: number }
): Promise<{ runtime: WorkflowModelViewerWarmRuntime; recycled: boolean }> {
  if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError');

  if (warm) {
    if (warm.timer) {
      clearTimeout(warm.timer);
      warm.timer = null;
    }
    if (isRendererContextLost(warm.runtime.renderer)) {
      const dead = warm;
      warm = null;
      disposeWarmSlot(dead);
    }
  }

  if (warm) {
    clearWarmSceneModels(warm.runtime.scene, warm.runtime.stage);
    warm.runtime.camera.position.set(0, 0.6, 2.4);
    warm.runtime.camera.near = 0.01;
    warm.runtime.camera.far = 2000;
    const canvas = warm.runtime.renderHost.getDomElement();
    if (canvas && canvas.parentElement !== container) {
      container.appendChild(canvas);
    }
    const w = Math.max(1, options?.width ?? container.clientWidth ?? 1);
    const h = Math.max(1, options?.height ?? container.clientHeight ?? 1);
    warm.runtime.camera.aspect = w / h;
    warm.runtime.camera.updateProjectionMatrix();
    warm.runtime.renderHost.resize(w, h, Math.min(window.devicePixelRatio || 1, 1.5));
    // Force a clear so a lost/stale buffer does not flash empty forever.
    try {
      warm.runtime.renderer.setRenderTarget(null);
      warm.runtime.renderer.clear();
    } catch {
      /* ignore */
    }
    return { runtime: warm.runtime, recycled: true };
  }

  const width = Math.max(1, options?.width ?? container.clientWidth ?? 1);
  const height = Math.max(1, options?.height ?? container.clientHeight ?? width * 0.56);

  const renderHost = createRenderHost({
    preferredBackend: 'webgl',
    fallbackBackend: 'webgl',
    requireClassicWebGl: true,
    container,
    visual: {
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      outputColorSpace: THREE.SRGBColorSpace,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1.02,
      clearColor: 0x000000,
      clearAlpha: 0,
    },
  });
  await renderHost.init();
  if (options?.signal?.aborted) {
    renderHost.dispose();
    throw new DOMException('aborted', 'AbortError');
  }

  const raw = renderHost.getRawRenderer();
  const canvas = renderHost.getDomElement();
  if (!(raw instanceof THREE.WebGLRenderer) || !canvas) {
    renderHost.dispose();
    throw new Error('RenderHost did not produce a WebGLRenderer');
  }

  renderHost.resize(width, height, Math.min(window.devicePixelRatio || 1, 1.5));
  configureWorkflowModelSoftShadows(raw);

  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.background = 'transparent';
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '3D model viewport');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 2000);
  camera.position.set(0, 0.6, 2.4);

  let stage: WorkflowModelViewerStage;
  try {
    stage = await createWorkflowModelViewerStageAsync(scene, raw, null, { signal: options?.signal });
  } catch (e) {
    renderHost.dispose();
    throw e;
  }

  const runtime: WorkflowModelViewerWarmRuntime = {
    renderHost,
    renderer: raw,
    scene,
    camera,
    stage,
  };
  warm = { runtime, timer: null, generation: 0 };
  return { runtime, recycled: false };
}

/**
 * Park canvas off-screen (still in document) and keep runtime warm briefly.
 * Call after removing model meshes from `runtime.scene`.
 */
export function releaseWorkflowModelViewerWarmRuntime(): void {
  if (!warm) return;
  if (warm.timer) clearTimeout(warm.timer);
  parkCanvas(warm.runtime);
  const gen = ++warm.generation;
  const slot = warm;
  warm.timer = setTimeout(() => {
    if (!warm || warm !== slot || warm.generation !== gen) return;
    disposeWarmSlot(slot);
    if (warm === slot) warm = null;
  }, WARM_HOLD_MS);
}

/** Force-drop warm slot (tests / memory pressure). */
export function disposeWorkflowModelViewerWarmRuntimeNow(): void {
  if (!warm) return;
  const slot = warm;
  warm = null;
  disposeWarmSlot(slot);
}

/** @internal vitest */
export function workflowModelViewerWarmRuntimeIsHeldForTests(): boolean {
  return Boolean(warm);
}
