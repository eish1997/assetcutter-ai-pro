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
  createWorkflowModelViewerStage,
  enhanceLoadedModelMaterials,
} from '../../../services/workflowModelViewerStage';

type ViewerStatus = 'loading' | 'ready' | 'error' | 'unsupported';

const ImageModel3DViewer: React.FC<LazyImagePreviewViewerProps> = ({ modelSrc, modelFileName, className }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [message, setMessage] = useState<string>('');

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

    const width = Math.max(1, mount.clientWidth || root.clientWidth);
    const height = Math.max(1, mount.clientHeight || root.clientHeight || width * 0.56);
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 2000);
    camera.position.set(0, 0.6, 2.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const stage = createWorkflowModelViewerStage(scene, renderer, null);

    while (mount.firstChild) mount.removeChild(mount.firstChild);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.background = 'transparent';
    renderer.domElement.style.cursor = 'grab';

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
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

    setStatus('loading');
    setMessage('');

    const onLoadError = () => {
      if (cancelled) return;
      setStatus('error');
      setMessage('3D 模型加载失败（链接、跨域或文件损坏）。含贴图的 OBJ 需同目录 .mtl 时可能不完整。');
    };

    const finishLoad = (object: THREE.Object3D) => {
      if (cancelled) return;
      loadedRoot = object;
      enhanceLoadedModelMaterials(object);
      object.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      scene.add(object);
      frameCameraToObject(camera, controls, object, { defaultView: '+x' });
      const box = new THREE.Box3().setFromObject(object);
      aimWorkflowModelLightsAtBox(stage.keyLight, stage.fillLight, stage.rimLight, box);
      groundMesh = createStudioGroundMesh(box);
      if (groundMesh) scene.add(groundMesh);
      setStatus('ready');
    };

    if (format === 'gltf') {
      new GLTFLoader().load(src, (gltf) => finishLoad(gltf.scene), undefined, onLoadError);
    } else if (format === 'fbx') {
      new FBXLoader().load(src, (group) => finishLoad(group), undefined, onLoadError);
    } else {
      new OBJLoader().load(src, (group) => finishLoad(group), undefined, onLoadError);
    }

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
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('mouseleave', onMouseUp);
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
      stage.dispose();
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
          3D 模型加载中…
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
