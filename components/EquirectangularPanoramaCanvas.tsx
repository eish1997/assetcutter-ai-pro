/**
 * 等距柱状图（equirectangular）全景预览：相机置于球心，向内看贴图球面。
 * 用于大图预览「全景模式」，依赖主工程 three，不引用仓库外示例工程。
 *
 * 内存：超大图 / data URL 全分辨率上传 GPU 易导致标签页 OOM，故在 CPU 侧按最长边缩小后再建纹理。
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PanoramaViewportProjection, PanoLocalReprojectSnapshot } from '../services/panoViewportProjection';

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

function wrap01(u: number): number {
  let x = u % 1;
  if (x < 0) x += 1;
  return x;
}

export type EquirectangularPanoramaCanvasProps = {
  imageSrc: string;
  className?: string;
};

export const EquirectangularPanoramaCanvas = forwardRef<
  PanoramaViewportProjection | null,
  EquirectangularPanoramaCanvasProps
>(function EquirectangularPanoramaCanvas({ imageSrc, className = '' }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const liveRef = useRef<{
    camera: THREE.PerspectiveCamera | null;
    mesh: THREE.Mesh | null;
    renderer: THREE.WebGLRenderer | null;
  }>({ camera: null, mesh: null, renderer: null });

  const animListenersRef = useRef(new Set<() => void>());

  useImperativeHandle(ref, (): PanoramaViewportProjection => {
    return {
      clientToEquirectNorm(clientX, clientY) {
        const { camera, mesh, renderer } = liveRef.current;
        if (!camera || !mesh || !renderer) return null;
        const canvas = renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return null;
        const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        const hits = raycaster.intersectObject(mesh, false);
        if (!hits.length) return null;
        const dir = hits[0]!.point.clone().normalize();
        const lat = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
        const lon = Math.atan2(dir.x, dir.z);
        const u = wrap01(lon / (2 * Math.PI) + 0.5);
        const v = THREE.MathUtils.clamp(0.5 - lat / Math.PI, 0, 1);
        return { x: u, y: v };
      },
      equirectNormToClient(u, v) {
        const { camera, renderer } = liveRef.current;
        if (!camera || !renderer) return null;
        const uu = wrap01(u);
        const vv = THREE.MathUtils.clamp(v, 0, 1);
        const lon = (uu - 0.5) * 2 * Math.PI;
        const lat = (0.5 - vv) * Math.PI;
        const wx = Math.cos(lat) * Math.sin(lon);
        const wy = Math.sin(lat);
        const wz = Math.cos(lat) * Math.cos(lon);
        const worldPos = new THREE.Vector3(wx, wy, wz).multiplyScalar(500);
        const camPos = new THREE.Vector3();
        camera.getWorldPosition(camPos);
        const toSurf = worldPos.clone().sub(camPos);
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        if (toSurf.dot(forward) < 0.02) return null;
        const projected = worldPos.clone().project(camera);
        if (projected.z > 1) return null;
        const rect = renderer.domElement.getBoundingClientRect();
        const sx = (projected.x * 0.5 + 0.5) * rect.width + rect.left;
        const sy = (-projected.y * 0.5 + 0.5) * rect.height + rect.top;
        return { x: sx, y: sy };
      },
      subscribeAnimation(fn) {
        const s = animListenersRef.current;
        s.add(fn);
        return () => {
          s.delete(fn);
        };
      },
      captureViewDataUrl(mime, quality) {
        const { renderer } = liveRef.current;
        if (!renderer) return null;
        try {
          return renderer.domElement.toDataURL(mime ?? 'image/png', quality);
        } catch {
          return null;
        }
      },
      getReprojectSnapshot(): PanoLocalReprojectSnapshot | null {
        const { camera, renderer } = liveRef.current;
        if (!camera || !renderer) return null;
        const el = renderer.domElement;
        const bw = el.width;
        const bh = el.height;
        if (bw < 1 || bh < 1) return null;
        const q = new THREE.Quaternion();
        camera.getWorldQuaternion(q);
        const p = new THREE.Vector3();
        camera.getWorldPosition(p);
        return {
          bufferW: bw,
          bufferH: bh,
          fovDeg: camera.fov,
          aspect: camera.aspect,
          cameraPosition: [p.x, p.y, p.z],
          cameraQuaternion: [q.x, q.y, q.z, q.w],
        };
      },
    };
  }, []);

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

    /** `preserveDrawingBuffer`：`captureViewDataUrl` / 裁切依赖 `toDataURL`，默认 false 时帧缓冲可能被清空导致透明快照 */
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true });
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

    liveRef.current = { camera, mesh: null, renderer };

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
        liveRef.current = { camera, mesh, renderer };
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
      for (const fn of animListenersRef.current) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
    };
    tick();

    return () => {
      cancelled = true;
      liveRef.current = { camera: null, mesh: null, renderer: null };
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
});
