/**
 * 等距柱状图（equirectangular）全景预览：相机置于球心，向内看贴图球面。
 * 用于大图预览「全景模式」，依赖主工程 three，不引用仓库外示例工程。
 *
 * 内存：超大图 / data URL 全分辨率上传 GPU 易导致标签页 OOM，故在 CPU 侧按最长边缩小后再建纹理。
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** 全景贴图最长边上限（像素），控制 WebGL 显存与 mipmap 开销 */
const PANORAMA_MAX_TEXTURE_EDGE = 4096;
/** 超过此边长则关闭 mipmap，避免额外约 1/3 显存 */
const PANORAMA_MIPMAP_MAX_EDGE = 2048;

function shouldUseAnonymousCors(src: string): boolean {
  if (!/^https?:\/\//i.test(src)) return false;
  try {
    const u = new URL(src, typeof window !== 'undefined' ? window.location.href : undefined);
    return typeof window !== 'undefined' && u.origin !== window.location.origin;
  } catch {
    return true;
  }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (shouldUseAnonymousCors(src)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/** 缩小后再上传 GPU，避免 8K/超大 base64 直接把标签页撑爆 */
function buildPanoramaTextureFromImage(img: HTMLImageElement): THREE.CanvasTexture {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) {
    throw new Error('invalid image dimensions');
  }
  const maxSrc = Math.max(nw, nh);
  const scale = maxSrc > PANORAMA_MAX_TEXTURE_EDGE ? PANORAMA_MAX_TEXTURE_EDGE / maxSrc : 1;
  const tw = Math.max(1, Math.floor(nw * scale));
  const th = Math.max(1, Math.floor(nh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d context unavailable');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, tw, th);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const maxTex = Math.max(tw, th);
  if (maxTex <= PANORAMA_MIPMAP_MAX_EDGE) {
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
  } else {
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
  }
  tex.needsUpdate = true;
  return tex;
}

export type EquirectangularPanoramaCanvasProps = {
  imageSrc: string;
  className?: string;
};

export const EquirectangularPanoramaCanvas: React.FC<EquirectangularPanoramaCanvasProps> = ({
  imageSrc,
  className = '',
}) => {
  /** 外层尺寸；勿在此节点上 innerHTML，以免破坏 React 管理的覆盖层 */
  const rootRef = useRef<HTMLDivElement>(null);
  /** 仅挂载 WebGL canvas，React 不向此节点插入其它子节点 */
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const root = rootRef.current;
    const mount = mountRef.current;
    if (!root || !mount || !imageSrc) return;

    let cancelled = false;
    let animationId = 0;
    let mesh: THREE.Mesh | null = null;
    let material: THREE.MeshBasicMaterial | null = null;
    let texture: THREE.Texture | null = null;
    let controls: OrbitControls | null = null;

    const width = Math.max(1, mount.clientWidth || root.clientWidth);
    const height = Math.max(1, mount.clientHeight || root.clientHeight || width * 0.56);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0c);

    const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 2000);
    const D = 0.02;
    camera.position.set(0, 0, D);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const geometry = new THREE.SphereGeometry(500, 64, 48);
    geometry.scale(-1, 1, 1);

    const onWheelZoom = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      if (e.deltaMode === 2) dy *= 120;
      const next = THREE.MathUtils.clamp(camera.fov + dy * 0.04, 28, 115);
      camera.fov = next;
      camera.updateProjectionMatrix();
    };

    const onCanvasMouseDown = () => {
      renderer.domElement.style.cursor = 'grabbing';
    };
    const onCanvasMouseUp = () => {
      renderer.domElement.style.cursor = 'grab';
    };

    while (mount.firstChild) {
      mount.removeChild(mount.firstChild);
    }
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.addEventListener('wheel', onWheelZoom, { passive: false });
    renderer.domElement.addEventListener('mousedown', onCanvasMouseDown);
    renderer.domElement.addEventListener('mouseup', onCanvasMouseUp);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.rotateSpeed = -0.32;
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = Math.PI - 0.08;
    controls.target.set(0, 0, 0);
    controls.minDistance = D;
    controls.maxDistance = D;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();

    setStatus('loading');
    void loadImageElement(imageSrc)
      .then((img) => {
        if (cancelled) return;
        let tex: THREE.CanvasTexture;
        try {
          tex = buildPanoramaTextureFromImage(img);
        } catch {
          if (!cancelled) setStatus('error');
          return;
        }
        if (cancelled) {
          tex.dispose();
          return;
        }
        texture = tex;
        material = new THREE.MeshBasicMaterial({ map: texture });
        mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    const ro = new ResizeObserver(() => {
      if (cancelled || !mount) return;
      const w = Math.max(1, mount.clientWidth || root.clientWidth);
      const h = Math.max(1, mount.clientHeight || root.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(root);

    const tick = () => {
      if (cancelled) return;
      animationId = requestAnimationFrame(tick);
      controls?.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationId);
      ro.disconnect();
      renderer.domElement.removeEventListener('wheel', onWheelZoom);
      renderer.domElement.removeEventListener('mousedown', onCanvasMouseDown);
      renderer.domElement.removeEventListener('mouseup', onCanvasMouseUp);
      controls?.dispose();
      if (mesh) scene.remove(mesh);
      geometry.dispose();
      material?.dispose();
      texture?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [imageSrc]);

  return (
    <div
      ref={rootRef}
      className={`relative w-full min-h-[200px] rounded-xl overflow-hidden border border-[#2e2e32] bg-[#0a0a0c] ${className}`}
      style={{ height: '100%' }}
    >
      <div ref={mountRef} className="absolute inset-0 z-0" aria-hidden />
      {status === 'loading' ? (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-500 z-[2] pointer-events-none">
          全景贴图加载中…
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-amber-200/90 px-4 text-center z-[2] pointer-events-none">
          无法以全景方式加载该图（可能被跨域限制或非标准全景长宽比）。请切回「平面」查看。
        </div>
      ) : null}
    </div>
  );
};
