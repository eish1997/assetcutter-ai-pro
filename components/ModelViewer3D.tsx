/**
 * 3D 模型展示（Three.js + GLTFLoader，支持 GLB/GLTF 在线预览）
 * 拖拽旋转、滚轮缩放。外部 URL 可通过 VITE_TENCENT_PROXY 的 /model 代理绕过 CORS（Failed to fetch）。
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const proxyBase = (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_TENCENT_PROXY as string)?.trim?.() || '';

export interface ModelViewer3DProps {
  url: string;
  onClose?: () => void;
  /** 常驻内联模式：不占满屏，无遮罩，适合嵌入页面中央预览区 */
  inline?: boolean;
}

const ModelViewer3D: React.FC<ModelViewer3DProps> = ({ url, onClose, inline = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (!containerRef.current || !url) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight || 400;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f0f1a);
    scene.environment = null;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(2, 2, 2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(3, 5, 2);
    dir.castShadow = true;
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0x88aaff, 0.3);
    dir2.position.set(-2, 2, -1);
    scene.add(dir2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 20;

    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);

    const loader = new GLTFLoader();
    let animationId: number;
    let loadedRoot: THREE.Group | null = null;

    function loadFromUrl(src: string) {
      loader.load(
        src,
        (gltf) => {
          if (loadedRoot) scene.remove(loadedRoot);
          loadedRoot = gltf.scene;
          scene.add(loadedRoot);
          const box = new THREE.Box3().setFromObject(loadedRoot);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          loadedRoot.position.sub(center);
          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 0) camera.position.set(maxDim, maxDim, maxDim).multiplyScalar(0.8);
          controls.target.set(0, 0, 0);
          setStatus('ready');
        },
        undefined,
        (err) => {
          setErrorMsg(err?.message || '加载失败');
          setStatus('error');
        }
      );
    }

    const isGLB = /\.glb$/i.test(url) || url.includes('glb');
    const isGLTF = url.includes('gltf');
    const isExternal = /^https?:\/\//i.test(url);
    const useProxy = proxyBase && isExternal;

    if (isGLB || isGLTF) {
      if (useProxy) {
        const fetchUrl = `${proxyBase.replace(/\/$/, '')}/model?url=${encodeURIComponent(url)}`;
        fetch(fetchUrl, { mode: 'cors', credentials: 'omit' })
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.blob();
          })
          .then((blob) => {
            const u = URL.createObjectURL(blob);
            objectUrlRef.current = u;
            loadFromUrl(u);
          })
          .catch((e) => {
            setErrorMsg((e?.message) || '代理拉取失败或网络错误');
            setStatus('error');
          });
      } else if (isExternal) {
        fetch(url, { mode: 'cors', credentials: 'omit' })
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.blob();
          })
          .then((blob) => {
            const u = URL.createObjectURL(blob);
            objectUrlRef.current = u;
            loadFromUrl(u);
          })
          .catch(() => loadFromUrl(url));
      } else {
        loadFromUrl(url);
      }
    } else {
      loadFromUrl(url);
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
      const h = containerRef.current.clientHeight || 400;
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
  }, [url]);

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
        <span className="text-gray-500 text-[10px]">外链受 CORS 限制：在 .env.local 中设置 VITE_TENCENT_PROXY 并启动代理后可在线预览</span>
      )}
      <span className="text-gray-500 text-[10px]">或直接下载 GLB/FBX 后用 Blender、Windows 3D 查看器等打开</span>
    </div>
  );
  const hint = <div className="absolute bottom-2 left-2 right-2 text-[9px] text-gray-500 text-center">拖拽旋转 · 滚轮缩放 · 左键平移</div>;

  if (inline) {
    return (
      <div className="relative w-full h-full min-h-[280px] rounded-2xl overflow-hidden border border-white/10 bg-black/60 flex flex-col">
        <div ref={containerRef} className="flex-1 min-h-[280px] rounded-2xl" />
        {overlayLoading}
        {overlayError}
        {hint}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4 lg:p-10" onClick={onClose}>
      <div className="relative w-full max-w-4xl h-[80vh] rounded-[2rem] overflow-hidden border border-white/10 bg-black/60 flex flex-col" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        {onClose && <button onClick={onClose} className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-white hover:bg-black/80 transition-colors">✕</button>}
        <div ref={containerRef} className="flex-1 min-h-[300px] rounded-[2rem]" />
        {overlayLoading}
        {overlayError}
        {hint}
      </div>
    </div>
  );
};

export default ModelViewer3D;
