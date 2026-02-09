/**
 * 统一 3D 预览：支持 OBJ、GLB/GLTF，风格与贴图修缝 3D 预览一致（深色网格、轨道控制）
 * 用于生成3D 模块等，支持外链代理（VITE_TENCENT_PROXY）
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const proxyBase = (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_TENCENT_PROXY as string)?.trim?.() || '';

function resolveFetchUrl(url: string, asBlob: boolean): string {
  const isExternal = /^https?:\/\//i.test(url);
  if (proxyBase && isExternal) {
    return `${proxyBase.replace(/\/$/, '')}/model?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export interface UnifiedModelViewer3DProps {
  url: string;
  /** 不传则根据 url 推断：.obj -> obj，否则 glb */
  format?: 'glb' | 'obj';
  /** 内联嵌入，与贴图修缝 3D 预览同风格 */
  inline?: boolean;
}

const UnifiedModelViewer3D: React.FC<UnifiedModelViewer3DProps> = ({ url, format, inline = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const inferredFormat: 'glb' | 'obj' = format ?? (/\.obj$/i.test(url) ? 'obj' : 'glb');

  useEffect(() => {
    if (!containerRef.current || !url) return;

    const width = containerRef.current.clientWidth || 400;
    const height = containerRef.current.clientHeight || 320;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a12);
    scene.environment = null;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
    camera.position.set(1.6, 1.2, 1.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 50;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(2.5, 3.5, 2);
    scene.add(dir);
    const grid = new THREE.GridHelper(4, 8, 0x3a4a62, 0x1b2635);
    (grid.material as THREE.Material).opacity = 0.25;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);

    let loadedRoot: THREE.Group | null = null;
    let animationId: number;

    function centerAndFrame(root: THREE.Group) {
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      root.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const d = maxDim * 1.6 + 0.6;
        camera.position.set(d, d * 0.7, d);
        camera.near = Math.max(0.001, d / 2000);
        camera.far = d * 50;
        camera.updateProjectionMatrix();
      }
      controls.target.set(0, 0, 0);
      setStatus('ready');
    }

    function onError(err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }

    const isExternal = /^https?:\/\//i.test(url);
    const useProxy = !!proxyBase && isExternal;
    const fetchUrl = useProxy ? resolveFetchUrl(url, true) : url;

    if (inferredFormat === 'obj') {
      fetch(fetchUrl, { mode: 'cors', credentials: 'omit' })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then((text) => {
          const loader = new OBJLoader();
          const root = loader.parse(text);
          root.traverse((o) => {
            if (o instanceof THREE.Mesh && o.geometry) o.geometry.computeVertexNormals();
          });
          loadedRoot = root;
          scene.add(root);
          centerAndFrame(root);
        })
        .catch(onError);
    } else {
      const doLoad = (src: string) => {
        const loader = new GLTFLoader();
        loader.load(
          src,
          (gltf) => {
            if (loadedRoot) scene.remove(loadedRoot);
            loadedRoot = gltf.scene;
            scene.add(loadedRoot);
            centerAndFrame(loadedRoot);
          },
          undefined,
          (err) => onError(err?.message || 'GLB/GLTF 加载失败')
        );
      };
      if (useProxy) {
        fetch(fetchUrl, { mode: 'cors', credentials: 'omit' })
          .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
          .then((blob) => {
            const u = URL.createObjectURL(blob);
            objectUrlRef.current = u;
            doLoad(u);
          })
          .catch(onError);
      } else if (isExternal) {
        fetch(url, { mode: 'cors', credentials: 'omit' })
          .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
          .then((blob) => {
            const u = URL.createObjectURL(blob);
            objectUrlRef.current = u;
            doLoad(u);
          })
          .catch(() => doLoad(url));
      } else {
        doLoad(url);
      }
    }

    function animate() {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    const onResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight || 320;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animationId);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      renderer.dispose();
      controls.dispose();
      if (containerRef.current?.contains(renderer.domElement)) containerRef.current.removeChild(renderer.domElement);
    };
  }, [url, inferredFormat]);

  const overlayLoading = status === 'loading' && (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-2xl">
      <span className="text-sm text-gray-400">加载模型中…</span>
    </div>
  );
  const overlayError = status === 'error' && (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-2 p-4 rounded-2xl">
      <span className="text-amber-400 text-sm">无法在线预览</span>
      <span className="text-gray-500 text-[10px]">{errorMsg}</span>
      {!proxyBase && /^https?:\/\//i.test(url) && (
        <span className="text-gray-500 text-[10px]">外链受 CORS 限制：设置 VITE_TENCENT_PROXY 并启动代理后可预览</span>
      )}
    </div>
  );
  const hint = <div className="absolute bottom-2 left-2 right-2 text-[9px] text-gray-500 text-center">拖拽旋转 · 滚轮缩放 · 左键平移</div>;

  return (
    <div className="relative w-full h-full min-h-[280px] rounded-2xl overflow-hidden border border-white/10 bg-[#0a0a12] flex flex-col">
      <div ref={containerRef} className="flex-1 min-h-[280px] rounded-2xl" />
      {overlayLoading}
      {overlayError}
      {hint}
    </div>
  );
};

export default UnifiedModelViewer3D;
