import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LazyImagePreviewViewerProps } from '../registry';
import { frameCameraToObject } from '../../../services/workflowModelThreeShared';
import {
  aimHeightfieldReliefLightsAtBox,
  applyHeightfieldMatcapSceneLighting,
  createStudioGroundMesh,
  createWorkflowModelViewerStageAsync,
} from '../../../services/workflowModelViewerStage';
import { readLocalString, writeLocalString } from '../../../services/clientPersist';
import { downloadMeshAsGlb } from '../../../services/heightfieldGlbExport';
import {
  buildHeightfieldDisplacementCanvas,
  clampHeightfieldPlaneSegments,
  readHeightfieldDispGrayPixels,
  sampleGrayDispBilinear,
} from '../../../services/imageHeightfieldLuminance';
import { createZbrushStyleGrayMatcapTexture } from '../../../services/imageHeightfieldGrayMatcap';
import { getHeightfieldQualitySettings } from '../../../services/imageHeightfieldQuality';
import { IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE } from '../../workflow/workflowSectionUiConstants';

const HF_QUALITY_STORAGE_KEY = 'ac_heightfield_quality01_v1';

/** 固定 MatCap 灰调乘色（已去掉材质切换 UI） */
const DEFAULT_HEIGHTFIELD_MATCAP_COLOR = '#a3a5ab';

function readStoredQuality01(): number {
  const raw = readLocalString(HF_QUALITY_STORAGE_KEY);
  if (raw == null || raw === '') return 0.55;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.55;
  return Math.max(0, Math.min(1, n));
}

type ViewerStatus = 'loading' | 'ready' | 'error';

const DEFAULT_DISPLACE_MUL = 1;

const ImageHeightfieldViewer: React.FC<LazyImagePreviewViewerProps> = ({
  imageSrc,
  className,
  toolbarPortalEl,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [message, setMessage] = useState('');
  const [displaceMul, setDisplaceMul] = useState(DEFAULT_DISPLACE_MUL);
  const displaceMulRef = useRef(DEFAULT_DISPLACE_MUL);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const [quality01, setQuality01] = useState(() => readStoredQuality01());
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState('');

  useEffect(() => {
    writeLocalString(HF_QUALITY_STORAGE_KEY, String(quality01));
  }, [quality01]);

  useEffect(() => {
    setDisplaceMul(DEFAULT_DISPLACE_MUL);
    displaceMulRef.current = DEFAULT_DISPLACE_MUL;
  }, [imageSrc]);

  useEffect(() => {
    displaceMulRef.current = displaceMul;
    const mesh = meshRef.current;
    const zb = mesh?.userData?.zBase as Float32Array | undefined;
    if (!mesh || !zb || !mesh.geometry) return;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, zb[i] * displaceMul);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    const n = mesh.geometry.attributes.normal as THREE.BufferAttribute;
    n.needsUpdate = true;
  }, [displaceMul]);

  useEffect(() => {
    const root = rootRef.current;
    const mount = mountRef.current;
    const src = (imageSrc || '').trim();
    if (!root || !mount) return;
    if (!src) {
      setStatus('error');
      setMessage('缺少预览图地址。');
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let stage: Awaited<ReturnType<typeof createWorkflowModelViewerStageAsync>> | null = null;
    let groundMesh: THREE.Mesh | null = null;
    const abortEnv = new AbortController();

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    const width = Math.max(1, mount.clientWidth || root.clientWidth);
    const height = Math.max(1, mount.clientHeight || root.clientHeight || width * 0.56);
    const scene = new THREE.Scene();
    const quality = getHeightfieldQualitySettings(quality01);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 2000);
    camera.position.set(0, 0.85, 2.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
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

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 0.2;
    controls.maxDistance = 24;
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

    const fail = (msg: string) => {
      if (cancelled) return;
      setStatus('error');
      setMessage(msg);
    };

    img.onerror = () => fail('图片加载失败（链接无效或跨域限制）。');

    img.onload = () => {
      if (cancelled) return;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) {
        fail('图片尺寸无效。');
        return;
      }

      let dispCanvas: HTMLCanvasElement;
      try {
        const disp = buildHeightfieldDisplacementCanvas(img, nw, nh, { maxEdge: quality.displaceMaxEdge });
        dispCanvas = disp.canvas;
      } catch {
        fail('无法处理图片像素（可能被跨域策略阻止）。');
        return;
      }

      const dispPx = readHeightfieldDispGrayPixels(dispCanvas);
      if (!dispPx) {
        fail('无法读取位移灰度像素。');
        return;
      }

      const ar = nw / nh;
      const maxPlane = 2.4;
      const planeW = ar >= 1 ? maxPlane : maxPlane * ar;
      const planeH = ar >= 1 ? maxPlane / ar : maxPlane;

      const { segX, segY } = clampHeightfieldPlaneSegments(dispCanvas.width, dispCanvas.height, quality.maxPlaneCells);

      const geo = new THREE.PlaneGeometry(planeW, planeH, segX, segY);
      const baseScale = Math.min(planeW, planeH) * (0.16 / 5);
      const posAttr = geo.attributes.position as THREE.BufferAttribute;
      const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
      const zBase = new Float32Array(posAttr.count);
      const mul0 = displaceMulRef.current;
      for (let i = 0; i < posAttr.count; i++) {
        const u = uvAttr.getX(i);
        const v = uvAttr.getY(i);
        const g = sampleGrayDispBilinear(dispPx, u, v);
        zBase[i] = g * baseScale;
        posAttr.setZ(i, zBase[i] * mul0);
      }
      posAttr.needsUpdate = true;
      geo.computeVertexNormals();

      const matcapTex = createZbrushStyleGrayMatcapTexture();
      const mat = new THREE.MeshMatcapMaterial({ matcap: matcapTex });
      mat.color.set(DEFAULT_HEIGHTFIELD_MATCAP_COLOR);
      mat.side = THREE.DoubleSide;
      mat.needsUpdate = true;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.baseDisplacementScale = baseScale;
      mesh.userData.zBase = zBase;
      meshRef.current = mesh;

      void (async () => {
        try {
          stage = await createWorkflowModelViewerStageAsync(scene, renderer, null, { signal: abortEnv.signal });
        } catch (e) {
          if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
          meshRef.current = null;
          geo.dispose();
          mat.dispose();
          if (!cancelled) fail('3D 环境（HDR）加载失败，请刷新重试。');
          return;
        }
        if (cancelled) {
          geo.dispose();
          mat.dispose();
          stage?.dispose();
          stage = null;
          return;
        }
        scene.add(mesh);
        frameCameraToObject(camera, controls, mesh, { defaultView: '+x' });
        if (cancelled) {
          scene.remove(mesh);
          mesh.geometry.dispose();
          mat.dispose();
          stage?.dispose();
          stage = null;
          meshRef.current = null;
          return;
        }
        const box = new THREE.Box3().setFromObject(mesh);
        aimHeightfieldReliefLightsAtBox(stage.keyLight, stage.fillLight, stage.rimLight, stage.bounceFill, box);
        applyHeightfieldMatcapSceneLighting(stage);
        groundMesh = createStudioGroundMesh(box, 8);
        if (groundMesh) scene.add(groundMesh);
        setStatus('ready');
      })();
    };

    img.src = src;

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
      abortEnv.abort();
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('mouseleave', onMouseUp);
      const mesh = meshRef.current;
      meshRef.current = null;
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        const m = mesh.material as THREE.MeshMatcapMaterial;
        m.dispose();
      }
      if (groundMesh) {
        scene.remove(groundMesh);
        groundMesh.geometry.dispose();
        (groundMesh.material as THREE.Material).dispose();
        groundMesh = null;
      }
      stage?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [imageSrc, quality01]);

  const onQualityInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    setQuality01(Math.max(0, Math.min(1, v / 100)));
  }, []);

  const onExportGlb = useCallback(async () => {
    const mesh = meshRef.current;
    if (!mesh) return;
    setExportBusy(true);
    setExportErr('');
    try {
      await downloadMeshAsGlb(mesh, `heightfield-${Date.now()}.glb`);
    } catch (err) {
      setExportErr(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExportBusy(false);
    }
  }, []);

  const onDisplaceInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    setDisplaceMul(Math.max(0.05, Math.min(2.5, v)));
  }, []);

  const stopToolbarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const useTopToolbar = Boolean(toolbarPortalEl);
  const readyChrome = (
    <>
      <div
        className={
          useTopToolbar
            ? 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'
            : 'flex w-full items-center gap-2'
        }
        onClick={stopToolbarClick}
      >
        <span className="shrink-0 text-gray-500">性能</span>
        <input
          id="ac-heightfield-quality"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(quality01 * 100)}
          onChange={onQualityInput}
          className={
            useTopToolbar
              ? 'h-1 w-[4.25rem] shrink-0 accent-blue-500 sm:w-24'
              : 'h-1 min-w-0 flex-1 accent-blue-500'
          }
          aria-label="高度 3D 画质与性能"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(quality01 * 100)}
        />
        <span className="shrink-0 text-gray-500">画质</span>
      </div>
      <div
        className={
          useTopToolbar
            ? 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'
            : 'flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-2'
        }
        onClick={stopToolbarClick}
      >
        <div className="flex items-center gap-1.5">
          <label htmlFor="ac-heightfield-displace" className="shrink-0 whitespace-nowrap text-gray-400">
            置换强度
          </label>
          <input
            id="ac-heightfield-displace"
            type="range"
            min={0.05}
            max={2.5}
            step={0.01}
            value={displaceMul}
            onChange={onDisplaceInput}
            className={
              useTopToolbar
                ? 'h-1 w-[4.5rem] shrink-0 accent-blue-500 sm:w-20'
                : 'h-1 w-[min(10rem,calc(100vw-10rem))] accent-blue-500'
            }
            aria-valuemin={0.05}
            aria-valuemax={2.5}
            aria-valuenow={displaceMul}
          />
        </div>
        {!useTopToolbar ? <span className="hidden h-4 w-px bg-white/15 sm:inline-block" aria-hidden /> : null}
        <button
          type="button"
          disabled={exportBusy}
          onClick={() => void onExportGlb()}
          className={
            useTopToolbar
              ? `${IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE} shrink-0 rounded-md px-2 py-1 text-[9px] font-semibold sm:text-[10px]`
              : 'shrink-0 rounded-md bg-white/10 px-2 py-1 text-[10px] font-medium text-gray-100 ring-1 ring-white/15 transition-colors hover:bg-white/15 disabled:pointer-events-none disabled:opacity-40'
          }
        >
          {exportBusy ? '导出中…' : '下载 GLB'}
        </button>
      </div>
      {exportErr ? (
        <div className={useTopToolbar ? 'w-full text-[9px] text-red-300/95' : 'text-center text-[9px] text-red-300/95'}>
          {exportErr}
        </div>
      ) : null}
    </>
  );

  const readyChromeWrapped =
    status === 'ready' && toolbarPortalEl ? (
      createPortal(
        <div
          className="pointer-events-auto flex min-w-0 flex-col gap-1 text-[9px] text-gray-300 sm:text-[10px]"
          onClick={stopToolbarClick}
        >
          {readyChrome}
        </div>,
        toolbarPortalEl
      )
    ) : status === 'ready' && !toolbarPortalEl ? (
      <div
        className="pointer-events-auto absolute bottom-3 left-1/2 z-[3] flex max-w-[min(96vw,28rem)] -translate-x-1/2 flex-col gap-2 rounded-lg bg-black/55 px-3 py-2 text-[10px] text-gray-300 ring-1 ring-white/[0.12] backdrop-blur-sm"
        onClick={stopToolbarClick}
      >
        {readyChrome}
      </div>
    ) : null;

  return (
    <div
      ref={rootRef}
      className={`relative h-full w-full min-h-0 overflow-hidden bg-transparent ${className ?? ''}`}
    >
      <div ref={mountRef} className="absolute inset-0 z-0" aria-hidden />
      {status === 'loading' ? (
        <div className="absolute inset-0 z-[2] flex items-center justify-center text-[10px] text-gray-500 pointer-events-none">
          高度 3D 加载中…
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-2 px-6 text-center text-[11px] text-amber-200/90 pointer-events-none">
          <span>{message || '无法显示高度 3D。'}</span>
        </div>
      ) : null}
      {readyChromeWrapped}
    </div>
  );
};

export default ImageHeightfieldViewer;
