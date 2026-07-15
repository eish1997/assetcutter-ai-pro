import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { LazyImagePreviewViewerProps } from '../registry';
import {
  disposeObjectHierarchy,
  frameCameraToObject,
  inferModelFormat,
} from '../../../services/workflowModelThreeShared';
import {
  aimWorkflowModelLightsAtBox,
  createStudioGroundMesh,
  createWorkflowModelViewerStageAsync,
  enhanceLoadedModelMaterials,
} from '../../../services/workflowModelViewerStage';

type ViewerStatus = 'loading' | 'ready' | 'error' | 'unsupported';

const ImageModel3DViewer: React.FC<LazyImagePreviewViewerProps> = ({
  modelSrc,
  modelFileName,
  model3dDisplayMode = 'material',
  className,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const applyDisplayModeRef = useRef<((mode: NonNullable<LazyImagePreviewViewerProps['model3dDisplayMode']>) => void) | null>(null);
  const displayModeRef = useRef<NonNullable<LazyImagePreviewViewerProps['model3dDisplayMode']>>('material');
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    displayModeRef.current = model3dDisplayMode;
    applyDisplayModeRef.current?.(model3dDisplayMode);
  }, [model3dDisplayMode]);

  useEffect(() => {
    const root = rootRef.current;
    const mount = mountRef.current;
    if (!root || !mount) return;
    const src = (modelSrc || '').trim();
    if (!src) {
      setStatus('unsupported');
      setMessage('当前资产没有可预览的 3D 模型链接。');
      return;
    }

    const format = inferModelFormat(src, modelFileName);
    if (format === 'unknown') {
      setStatus('unsupported');
      setMessage('无法识别模型格式。本地文件请保留扩展名（.glb / .gltf / .fbx / .obj）。');
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let loadedRoot: THREE.Object3D | null = null;
    let groundMesh: THREE.Mesh | null = null;
    let stage: Awaited<ReturnType<typeof createWorkflowModelViewerStageAsync>> | null = null;
    const originalMaterials = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const clayMaterial = new THREE.MeshStandardMaterial({
      color: 0x808080,
      roughness: 0.78,
      metalness: 0.02,
    });
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0xcbd5e1,
      wireframe: true,
      transparent: true,
      opacity: 0.96,
    });
    const normalMaterial = new THREE.MeshNormalMaterial();
    const abortEnv = new AbortController();

    const width = Math.max(1, mount.clientWidth || root.clientWidth);
    const height = Math.max(1, mount.clientHeight || root.clientHeight || width * 0.56);
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 2000);
    camera.position.set(0, 0.6, 2.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    while (mount.firstChild) mount.removeChild(mount.firstChild);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.background = 'transparent';
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.style.touchAction = 'none';

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.minDistance = 0.25;
    controls.maxDistance = 20;
    controls.target.set(0, 0, 0);

    const onMouseDown = () => {
      renderer.domElement.style.cursor = 'grabbing';
    };
    const onMouseUp = () => {
      renderer.domElement.style.cursor = 'grab';
    };
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('mouseleave', onMouseUp);

    const onGlLost = (e: Event) => {
      try {
        e.preventDefault();
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      setStatus('error');
      setMessage(
        'WebGL 上下文已丢失（常见于系统「另存为」对话框弹出时 GPU 被抢占）。请关闭弹窗后重新打开大图预览，或刷新页面。'
      );
    };
    renderer.domElement.addEventListener('webglcontextlost', onGlLost);

    setStatus('loading');
    setMessage('');

    const restoreOriginalMaterials = () => {
      if (!loadedRoot) return;
      loadedRoot.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const original = originalMaterials.get(obj);
        if (original) obj.material = original;
      });
    };

    applyDisplayModeRef.current = (mode: NonNullable<LazyImagePreviewViewerProps['model3dDisplayMode']>) => {
      if (!loadedRoot) return;
      restoreOriginalMaterials();
      const useGround = mode !== 'wire' && mode !== 'normal';
      if (groundMesh) groundMesh.visible = useGround;
      if (mode === 'material') return;
      loadedRoot.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        if (!originalMaterials.has(obj)) originalMaterials.set(obj, obj.material);
        if (mode === 'clay') obj.material = clayMaterial;
        if (mode === 'wire') obj.material = wireMaterial;
        if (mode === 'normal') obj.material = normalMaterial;
      });
    };

    const onLoadError = () => {
      if (cancelled) return;
      setStatus('error');
      setMessage('3D 模型加载失败（链接、跨域或文件损坏）。含贴图的 OBJ 需同目录 .mtl 时可能不完整。');
    };

    const finishLoad = (object: THREE.Object3D) => {
      if (cancelled || !stage) return;
      loadedRoot = object;
      enhanceLoadedModelMaterials(object);
      object.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.isMesh) {
          originalMaterials.set(m, m.material);
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      scene.add(object);
      frameCameraToObject(camera, controls, object, { defaultView: '+x' });
      const box = new THREE.Box3().setFromObject(object);
      aimWorkflowModelLightsAtBox(stage.keyLight, stage.fillLight, stage.rimLight, stage.bounceFill, box);
      groundMesh = createStudioGroundMesh(box);
      if (groundMesh) scene.add(groundMesh);
      applyDisplayModeRef.current?.(displayModeRef.current);
      setStatus('ready');
    };

    void (async () => {
      try {
        stage = await createWorkflowModelViewerStageAsync(scene, renderer, null, { signal: abortEnv.signal });
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        if (!cancelled) {
          setStatus('error');
          setMessage('3D 环境（HDR）加载失败，请刷新重试。');
        }
        return;
      }
      if (cancelled) {
        stage?.dispose();
        stage = null;
        return;
      }
      if (format === 'gltf') {
        new GLTFLoader().load(src, (gltf) => finishLoad(gltf.scene), undefined, onLoadError);
      } else if (format === 'fbx') {
        new FBXLoader().load(src, (group) => finishLoad(group), undefined, onLoadError);
      } else {
        new OBJLoader().load(src, (group) => finishLoad(group), undefined, onLoadError);
      }
    })();

    const ro = new ResizeObserver(() => {
      if (cancelled || !mount) return;
      const w = Math.max(1, mount.clientWidth || root.clientWidth);
      const h = Math.max(1, mount.clientHeight || root.clientHeight || 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(root);

    const tick = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(tick);
      try {
        const gl = renderer.getContext() as WebGLRenderingContext | null;
        if (gl?.isContextLost?.()) return;
        controls.update();
        renderer.render(scene, camera);
      } catch {
        /* 上下文丢失后 render 可能抛错，避免拖垮 React */
      }
    };
    tick();

    return () => {
      cancelled = true;
      abortEnv.abort();
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('mouseleave', onMouseUp);
      renderer.domElement.removeEventListener('webglcontextlost', onGlLost);
      applyDisplayModeRef.current = null;
      restoreOriginalMaterials();
      if (loadedRoot) {
        scene.remove(loadedRoot);
        disposeObjectHierarchy(loadedRoot);
      }
      if (groundMesh) {
        scene.remove(groundMesh);
        groundMesh.geometry.dispose();
        (groundMesh.material as THREE.Material).dispose();
        groundMesh = null;
      }
      clayMaterial.dispose();
      wireMaterial.dispose();
      normalMaterial.dispose();
      stage?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [modelSrc, modelFileName]);

  return (
    <div
      ref={rootRef}
      className={`relative h-full w-full min-h-0 overflow-hidden bg-transparent ${className ?? ''}`}
    >
      <div ref={mountRef} className="absolute inset-0 z-0" aria-hidden />
      {status === 'loading' ? (
        <div className="absolute inset-0 z-[2] flex items-center justify-center text-[10px] text-gray-500 pointer-events-none">
          3D 环境与模型加载中…
        </div>
      ) : null}
      {status === 'error' || status === 'unsupported' ? (
        <div className="absolute inset-0 z-[2] flex items-center justify-center text-[10px] text-amber-200/90 px-4 text-center pointer-events-none">
          {message}
        </div>
      ) : null}
    </div>
  );
};

export default ImageModel3DViewer;
