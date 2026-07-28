import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  frameCameraToObject,
  inferModelFormat,
} from './workflowModelThreeShared';
import {
  acquireWorkflowModelSceneInstance,
  disposeWorkflowModelSceneInstance,
} from './workflowModelSceneCache';
import {
  aimWorkflowModelLightsAtBox,
  configureWorkflowModelSoftShadows,
  createStudioGroundMesh,
  createWorkflowModelViewerStageAsync,
  enhanceLoadedModelMaterials,
} from './workflowModelViewerStage';
import { createRenderHost, type RenderHost } from './renderCore';

export type CaptureWorkflowModelThumbOptions = {
  modelSrc: string;
  modelFileName?: string;
  /** 输出 JPEG 画布宽，默认 1280（供灯箱「平面」与网格渐进源图更清晰） */
  width?: number;
  /** 输出 JPEG 画布高，默认 800 */
  height?: number;
  timeoutMs?: number;
};

/** Serialize offscreen captures — concurrent WebGL+PMREM storms black-screen Electron companion. */
let captureQueueTail: Promise<unknown> = Promise.resolve();

/**
 * 离屏加载模型并渲染若干帧后导出 JPEG data URL，供工作区卡片缩略图使用。
 * 灯光与主预览一致（HDR→PMREM，失败则 Room）；使用 `preserveDrawingBuffer` 以稳定 `toDataURL`。
 * Captures are globally serialized (one at a time).
 * 模型解析走 {@link acquireWorkflowModelSceneInstance}，与大图预览共用 LRU，避免重复 parse。
 */
export function captureWorkflowModelThumbnailDataUrl(
  opts: CaptureWorkflowModelThumbOptions
): Promise<string | null> {
  const run = () => captureWorkflowModelThumbnailDataUrlNow(opts);
  const next = captureQueueTail.then(run, run);
  captureQueueTail = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function captureWorkflowModelThumbnailDataUrlNow(
  opts: CaptureWorkflowModelThumbOptions
): Promise<string | null> {
  const modelSrc = String(opts.modelSrc || '').trim();
  if (!modelSrc) return Promise.resolve(null);

  const format = inferModelFormat(modelSrc, opts.modelFileName);
  if (format === 'unknown') return Promise.resolve(null);

  const w = Math.max(256, Math.min(1920, opts.width ?? 1280));
  const h = Math.max(160, Math.min(1200, opts.height ?? 800));
  const timeoutMs = Math.max(5000, Math.min(120_000, opts.timeoutMs ?? 55_000));

  return new Promise((resolve) => {
    let settled = false;
    let torn = false;
    let loadedRoot: THREE.Object3D | null = null;
    let groundMesh: THREE.Mesh | null = null;
    let stage: Awaited<ReturnType<typeof createWorkflowModelViewerStageAsync>> | null = null;
    let renderHost: RenderHost | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 2000);
    camera.position.set(0, 0.6, 2.4);

    const teardown = () => {
      if (torn) return;
      torn = true;
      if (loadedRoot) {
        scene.remove(loadedRoot);
        disposeWorkflowModelSceneInstance(loadedRoot);
        loadedRoot = null;
      }
      if (groundMesh) {
        scene.remove(groundMesh);
        groundMesh.geometry.dispose();
        (groundMesh.material as THREE.Material).dispose();
        groundMesh = null;
      }
      stage?.dispose();
      stage = null;
      controls?.dispose();
      controls = null;
      renderHost?.dispose();
      renderHost = null;
      renderer = null;
    };

    const finish = (v: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      teardown();
      resolve(v);
    };

    const timer = window.setTimeout(() => finish(null), timeoutMs);

    const onLoaded = (object: THREE.Object3D) => {
      if (settled) {
        disposeWorkflowModelSceneInstance(object);
        return;
      }
      if (!stage || !renderHost || !controls || !renderer) {
        disposeWorkflowModelSceneInstance(object);
        finish(null);
        return;
      }
      try {
        loadedRoot = object;
        enhanceLoadedModelMaterials(object);
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        scene.add(object);
        frameCameraToObject(camera, controls, object, {
          defaultView: '+x',
          viewDirection: new THREE.Vector3(1, Math.SQRT2, 1),
          fitPadding: 1.24,
        });
        const box = new THREE.Box3().setFromObject(object);
        aimWorkflowModelLightsAtBox(stage.keyLight, stage.fillLight, stage.rimLight, stage.bounceFill, box);
        groundMesh = createStudioGroundMesh(box);
        if (groundMesh) scene.add(groundMesh);
        for (let i = 0; i < 18; i += 1) {
          controls.update();
          renderHost.render(scene, camera);
        }
        const dataUrl =
          renderHost.capture('image/jpeg', 0.9) ||
          renderer.domElement.toDataURL('image/jpeg', 0.9);
        const ok =
          dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/png');
        finish(ok ? dataUrl : null);
      } catch {
        finish(null);
      }
    };

    void (async () => {
      try {
        renderHost = createRenderHost({
          // Offscreen thumbs use PMREM → classic WebGL only (never probe WebGPU).
          preferredBackend: 'webgl',
          fallbackBackend: 'webgl',
          requireClassicWebGl: true,
          visual: {
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: true,
            outputColorSpace: THREE.SRGBColorSpace,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.02,
          },
        });
        await renderHost.init();
        const raw = renderHost.getRawRenderer();
        const canvas = renderHost.getDomElement();
        if (!(raw instanceof THREE.WebGLRenderer) || !canvas) {
          finish(null);
          return;
        }
        renderer = raw;
        renderHost.resize(w, h, 1);
        configureWorkflowModelSoftShadows(renderer);

        controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.12;
        controls.enablePan = false;
        controls.minDistance = 0.25;
        controls.maxDistance = 20;
        controls.target.set(0, 0, 0);

        // 离屏缩略图：50% 中性灰底（#808080），便于观察光照与阴影
        stage = await createWorkflowModelViewerStageAsync(scene, renderer, 0x808080);
      } catch {
        finish(null);
        return;
      }
      if (settled || torn) {
        stage?.dispose();
        stage = null;
        return;
      }
      try {
        const { root } = await acquireWorkflowModelSceneInstance({
          src: modelSrc,
          fileName: opts.modelFileName,
        });
        onLoaded(root);
      } catch {
        finish(null);
      }
    })();
  });
}
