import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LazyImagePreviewViewerProps } from '../registry';
import { frameCameraToObject } from '../../../services/workflowModelThreeShared';
import {
  aimHeightfieldReliefLightsAtBox,
  applyHeightfieldMatcapSceneLighting,
  configureWorkflowModelSoftShadows,
  createStudioGroundMesh,
  createWorkflowModelViewerStageAsync,
} from '../../../services/workflowModelViewerStage';
import { readLocalString, writeLocalString } from '../../../services/clientPersist';
import { downloadHeightfieldMesh, type HeightfieldMeshExportFormat } from '../../../services/heightfieldMeshExport';
import {
  buildHeightfieldDisplacementCanvas,
  clampHeightfieldPlaneSegments,
  readHeightfieldDispGrayPixels,
  sampleGrayDispBilinear,
} from '../../../services/imageHeightfieldLuminance';
import { createZbrushStyleGrayMatcapTexture } from '../../../services/imageHeightfieldGrayMatcap';
import {
  getHeightfieldQualitySettings,
  HEIGHTFIELD_QUALITY_TIERS,
  heightfieldQualityTierTo01,
  type HeightfieldQualityTierId,
} from '../../../services/imageHeightfieldQuality';
import { applyHeightfieldCylinderWrapPositions } from '../../../services/imageHeightfieldCylinderWrap';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import {
  IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE,
  IMAGE_LIGHTBOX_TOOL_TEXT_BTN_IDLE,
} from '../../workflow/workflowSectionUiConstants';

const HF_QUALITY_STORAGE_KEY = 'ac_heightfield_quality_tier_v1';
const HF_QUALITY_LEGACY_KEY = 'ac_heightfield_quality01_v1';

/** 固定 MatCap 灰调乘色（已去掉材质切换 UI） */
const DEFAULT_HEIGHTFIELD_MATCAP_COLOR = '#a3a5ab';

function readStoredQualityTier(): HeightfieldQualityTierId {
  const tierRaw = readLocalString(HF_QUALITY_STORAGE_KEY);
  if (tierRaw != null && tierRaw !== '') {
    const n = Number(tierRaw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return Math.round(n) as HeightfieldQualityTierId;
  }
  const legacy = readLocalString(HF_QUALITY_LEGACY_KEY);
  if (legacy != null && legacy !== '') {
    const n = Number(legacy);
    if (Number.isFinite(n)) {
      if (n < 0.34) return 0;
      if (n < 0.67) return 1;
      return 2;
    }
  }
  return 1;
}

type HeightfieldRuntime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  stage: Awaited<ReturnType<typeof createWorkflowModelViewerStageAsync>> | null;
  groundMesh: THREE.Mesh | null;
  loadedImg: HTMLImageElement | null;
  ready: boolean;
};

function disposeHeightfieldMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const mat = mesh.material as THREE.MeshMatcapMaterial;
  mat.matcap?.dispose();
  mat.dispose();
}

function buildHeightfieldMeshFromImage(
  img: HTMLImageElement,
  quality01: number,
  displaceMul: number,
  curl01: number
): THREE.Mesh | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null;

  const quality = getHeightfieldQualitySettings(quality01);
  let dispCanvas: HTMLCanvasElement;
  try {
    const disp = buildHeightfieldDisplacementCanvas(img, nw, nh, { maxEdge: quality.displaceMaxEdge });
    dispCanvas = disp.canvas;
  } catch {
    return null;
  }

  const dispPx = readHeightfieldDispGrayPixels(dispCanvas);
  if (!dispPx) return null;

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
  const flatX = new Float32Array(posAttr.count);
  const flatY = new Float32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    const g = sampleGrayDispBilinear(dispPx, u, v);
    zBase[i] = g * baseScale;
    flatX[i] = posAttr.getX(i);
    flatY[i] = posAttr.getY(i);
    posAttr.setZ(i, zBase[i] * displaceMul);
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();

  const matcapTex = createZbrushStyleGrayMatcapTexture();
  const mat = new THREE.MeshMatcapMaterial({ matcap: matcapTex });
  mat.color.set(DEFAULT_HEIGHTFIELD_MATCAP_COLOR);
  mat.side = THREE.DoubleSide;
  mat.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.baseDisplacementScale = baseScale;
  mesh.userData.zBase = zBase;
  mesh.userData.planeW = planeW;
  mesh.userData.flatX = flatX;
  mesh.userData.flatY = flatY;
  applyHeightfieldCylinderWrapPositions(mesh, curl01, displaceMul);
  return mesh;
}

function refreshHeightfieldStageLighting(rt: HeightfieldRuntime, mesh: THREE.Mesh): void {
  const box = new THREE.Box3().setFromObject(mesh);
  if (rt.stage) {
    aimHeightfieldReliefLightsAtBox(rt.stage.keyLight, rt.stage.fillLight, rt.stage.rimLight, rt.stage.bounceFill, box);
    applyHeightfieldMatcapSceneLighting(rt.stage);
  }
  if (rt.groundMesh) {
    rt.scene.remove(rt.groundMesh);
    rt.groundMesh.geometry.dispose();
    (rt.groundMesh.material as THREE.Material).dispose();
    rt.groundMesh = null;
  }
  rt.groundMesh = createStudioGroundMesh(box, 8);
  if (rt.groundMesh) rt.scene.add(rt.groundMesh);
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
  /** 0=平面，1=左右边相接（整圈外壁） */
  const [curl01, setCurl01] = useState(0);
  const curl01Ref = useRef(0);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const runtimeRef = useRef<HeightfieldRuntime | null>(null);
  const qualityTierRef = useRef<HeightfieldQualityTierId>(readStoredQualityTier());
  const [qualityTier, setQualityTier] = useState<HeightfieldQualityTierId>(() => readStoredQualityTier());
  qualityTierRef.current = qualityTier;
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    writeLocalString(HF_QUALITY_STORAGE_KEY, String(qualityTier));
  }, [qualityTier]);

  useEffect(() => {
    setDisplaceMul(DEFAULT_DISPLACE_MUL);
    displaceMulRef.current = DEFAULT_DISPLACE_MUL;
    setCurl01(0);
    curl01Ref.current = 0;
  }, [imageSrc]);

  useEffect(() => {
    displaceMulRef.current = displaceMul;
  }, [displaceMul]);

  useEffect(() => {
    curl01Ref.current = curl01;
  }, [curl01]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh?.userData?.flatX) return;
    applyHeightfieldCylinderWrapPositions(mesh, curl01, displaceMul);
  }, [displaceMul, curl01]);

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
    const quality01 = heightfieldQualityTierTo01(qualityTierRef.current);
    const quality = getHeightfieldQualitySettings(quality01);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 2000);
    /** 首帧在 HDR 完成前：略偏上、从 +Z 朝立面看，与 `frameCameraToObject` 的 +z 一致 */
    camera.position.set(0, 0.12, 2.35);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
    renderer.setSize(width, height);
    configureWorkflowModelSoftShadows(renderer);

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

    runtimeRef.current = {
      scene,
      camera,
      controls,
      renderer,
      stage: null,
      groundMesh: null,
      loadedImg: null,
      ready: false,
    };

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
      runtimeRef.current!.loadedImg = img;

      const mesh = buildHeightfieldMeshFromImage(
        img,
        heightfieldQualityTierTo01(qualityTierRef.current),
        displaceMulRef.current,
        curl01Ref.current
      );
      if (!mesh) {
        fail('无法处理图片像素（可能被跨域策略阻止）。');
        return;
      }
      meshRef.current = mesh;

      void (async () => {
        try {
          stage = await createWorkflowModelViewerStageAsync(scene, renderer, null, { signal: abortEnv.signal });
        } catch (e) {
          if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
          meshRef.current = null;
          disposeHeightfieldMesh(mesh);
          if (!cancelled) fail('3D 环境（HDR）加载失败，请刷新重试。');
          return;
        }
        if (cancelled) {
          disposeHeightfieldMesh(mesh);
          stage?.dispose();
          stage = null;
          return;
        }
        scene.add(mesh);
        frameCameraToObject(camera, controls, mesh, { defaultView: '+z' });
        if (cancelled) {
          scene.remove(mesh);
          disposeHeightfieldMesh(mesh);
          stage?.dispose();
          stage = null;
          meshRef.current = null;
          return;
        }
        groundMesh = createStudioGroundMesh(new THREE.Box3().setFromObject(mesh), 8);
        if (groundMesh) scene.add(groundMesh);
        const rt = runtimeRef.current;
        if (rt) {
          rt.stage = stage;
          rt.groundMesh = groundMesh;
          refreshHeightfieldStageLighting(rt, mesh);
          rt.ready = true;
        }
        queueMicrotask(() => {
          const m = meshRef.current;
          if (m && m.userData.flatX) {
            applyHeightfieldCylinderWrapPositions(m, curl01Ref.current, displaceMulRef.current);
          }
        });
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
        disposeHeightfieldMesh(mesh);
      }
      const rt = runtimeRef.current;
      if (rt?.groundMesh) {
        rt.scene.remove(rt.groundMesh);
        rt.groundMesh.geometry.dispose();
        (rt.groundMesh.material as THREE.Material).dispose();
      }
      rt?.stage?.dispose();
      runtimeRef.current = null;
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [imageSrc]); // 画质档位单独 effect 重建网格，不重置相机

  useEffect(() => {
    const rt = runtimeRef.current;
    if (!rt?.ready || !rt.loadedImg) return;

    const camPos = rt.camera.position.clone();
    const camTarget = rt.controls.target.clone();

    const old = meshRef.current;
    if (old) {
      rt.scene.remove(old);
      disposeHeightfieldMesh(old);
    }

    const q01 = heightfieldQualityTierTo01(qualityTier);
    const mesh = buildHeightfieldMeshFromImage(
      rt.loadedImg,
      q01,
      displaceMulRef.current,
      curl01Ref.current
    );
    if (!mesh) return;
    meshRef.current = mesh;
    rt.scene.add(mesh);

    const q = getHeightfieldQualitySettings(q01);
    rt.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatioCap));
    refreshHeightfieldStageLighting(rt, mesh);

    rt.camera.position.copy(camPos);
    rt.controls.target.copy(camTarget);
    rt.controls.update();
  }, [qualityTier]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onPtr = (e: PointerEvent) => {
      const el = exportMenuWrapRef.current;
      if (el && !el.contains(e.target as Node)) setExportMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPtr, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPtr, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [exportMenuOpen]);

  const onQualityTierPick = useCallback((tier: HeightfieldQualityTierId) => {
    setQualityTier(tier);
  }, []);

  const onExportPickFormat = useCallback(async (format: HeightfieldMeshExportFormat) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    setExportMenuOpen(false);
    setExportBusy(true);
    setExportErr('');
    try {
      await downloadHeightfieldMesh(mesh, format, `heightfield-${Date.now()}`);
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

  const onCurlInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    setCurl01(Math.max(0, Math.min(1, v / 100)));
  }, []);

  const stopToolbarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const hfTierChip = (active: boolean) =>
    `min-h-[1.5rem] min-w-0 flex-1 rounded-md px-1 py-0.5 text-[9px] font-bold ring-1 transition-colors ${
      active
        ? 'bg-blue-500/25 text-blue-100 ring-blue-400/50'
        : 'bg-white/[0.04] text-gray-400 ring-white/10 hover:bg-white/[0.08] hover:text-gray-200'
    }`;
  const useTopToolbar = Boolean(toolbarPortalEl);
  /** Portal 到侧栏：标签左、滑条右占满剩余宽度 */
  const hfRowPortal = 'flex w-full min-w-0 items-center gap-2';
  const hfLabelPortal = 'shrink-0 w-[4.5rem] text-[9px] font-medium leading-tight text-gray-400';
  const hfRangePortal = 'h-2 min-w-0 flex-1 cursor-pointer accent-blue-500';
  const readyChrome = (
    <>
      <div
        className={useTopToolbar ? hfRowPortal : 'flex w-full items-center gap-2'}
        onClick={stopToolbarClick}
      >
        {useTopToolbar ? (
          <span className={hfLabelPortal}>画质与性能</span>
        ) : (
          <span className="shrink-0 text-gray-500">画质</span>
        )}
        <div
          role="group"
          aria-label="高度 3D 画质与性能"
          className="flex min-w-0 flex-1 items-center gap-1"
        >
          {HEIGHTFIELD_QUALITY_TIERS.map((tier) => (
            <button
              key={tier.id}
              type="button"
              onClick={() => onQualityTierPick(tier.id)}
              className={hfTierChip(qualityTier === tier.id)}
              aria-pressed={qualityTier === tier.id}
            >
              {tier.label}
            </button>
          ))}
        </div>
      </div>
      <div
        className={
          useTopToolbar
            ? 'flex w-full min-w-0 flex-col gap-2'
            : 'flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-2'
        }
        onClick={stopToolbarClick}
      >
        <div className={useTopToolbar ? hfRowPortal : 'flex min-w-0 flex-1 items-center gap-1.5 sm:basis-[min(45%,14rem)]'}>
          <label
            htmlFor="ac-heightfield-displace"
            className={useTopToolbar ? hfLabelPortal : 'w-14 shrink-0 text-gray-400 sm:w-auto'}
          >
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
                ? hfRangePortal
                : 'h-1 w-[min(10rem,calc(100vw-10rem))] accent-blue-500'
            }
            aria-valuemin={0.05}
            aria-valuemax={2.5}
            aria-valuenow={displaceMul}
          />
        </div>
        <div className={useTopToolbar ? hfRowPortal : 'flex min-w-0 flex-1 items-center gap-1.5 sm:basis-[min(45%,14rem)]'}>
          <label
            htmlFor="ac-heightfield-curl"
            className={useTopToolbar ? hfLabelPortal : 'w-14 shrink-0 text-gray-400 sm:w-auto'}
            title="左右边沿卷成外壁圆柱，满量程时两边相接"
          >
            卷成圆柱
          </label>
          <input
            id="ac-heightfield-curl"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(curl01 * 100)}
            onChange={onCurlInput}
            className={
              useTopToolbar ? hfRangePortal : 'h-1 w-[min(8rem,calc(100vw-12rem))] accent-blue-500'
            }
            aria-label="高度 3D：周向卷成圆柱"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(curl01 * 100)}
          />
        </div>
        {!useTopToolbar ? <span className="hidden h-4 w-px bg-white/15 sm:inline-block" aria-hidden /> : null}
        <div
          ref={exportMenuWrapRef}
          className={useTopToolbar ? 'relative flex w-full shrink-0 justify-center' : 'relative shrink-0'}
        >
          <button
            type="button"
            disabled={exportBusy}
            aria-expanded={exportMenuOpen}
            aria-haspopup="menu"
            aria-label={exportBusy ? '导出中' : '导出模型'}
            title={exportBusy ? '导出中…' : '导出模型：选择格式下载'}
            onClick={() => setExportMenuOpen((o) => !o)}
            className={
              useTopToolbar
                ? `${IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE} inline-flex items-center gap-0 px-0.5`
                : 'inline-flex shrink-0 items-center gap-1 rounded-md bg-white/10 px-2.5 py-1.5 text-[10px] font-medium whitespace-nowrap text-gray-100 ring-1 ring-white/15 transition-colors hover:bg-white/15 disabled:pointer-events-none disabled:opacity-40'
            }
          >
            {useTopToolbar ? (
              <>
                {exportBusy ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin opacity-80" aria-hidden />
                ) : (
                  <Download className="size-3.5 shrink-0 opacity-80" aria-hidden />
                )}
                <ChevronDown
                  className={`size-3 shrink-0 opacity-60 transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </>
            ) : (
              <>
                <Download className="size-3.5 shrink-0 opacity-80" aria-hidden />
                <span>{exportBusy ? '导出中…' : '导出模型'}</span>
                <ChevronDown
                  className={`size-3 shrink-0 opacity-60 transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </>
            )}
          </button>
          {exportMenuOpen ? (
            <div
              role="menu"
              className={
                useTopToolbar
                  ? 'absolute left-1/2 top-full z-[80] mt-1.5 min-w-[13rem] max-h-[min(70vh,22rem)] -translate-x-1/2 overflow-y-auto rounded-xl bg-[#121214] py-1 text-left text-[10px] text-gray-200 shadow-2xl ring-1 ring-white/[0.14]'
                  : 'absolute left-1/2 bottom-full z-[80] mb-1.5 min-w-[13rem] max-h-[min(70vh,22rem)] -translate-x-1/2 overflow-y-auto rounded-xl bg-[#121214] py-1 text-left text-[10px] text-gray-200 shadow-2xl ring-1 ring-white/[0.14]'
              }
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="px-2.5 py-1.5 text-[9px] font-medium text-gray-500">选择导出格式</div>
              <button
                type="button"
                role="menuitem"
                className="flex w-full flex-col items-start gap-0.5 px-2.5 py-2 text-left hover:bg-white/[0.07] active:bg-white/[0.04]"
                onClick={() => void onExportPickFormat('glb')}
              >
                <span className="font-semibold text-gray-100">GLB</span>
                <span className="text-[9px] leading-snug text-gray-500">二进制 glTF，兼容性好</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full flex-col items-start gap-0.5 px-2.5 py-2 text-left hover:bg-white/[0.07] active:bg-white/[0.04]"
                onClick={() => void onExportPickFormat('gltf')}
              >
                <span className="font-semibold text-gray-100">glTF（JSON）</span>
                <span className="text-[9px] leading-snug text-gray-500">文本 + 内嵌资源</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full flex-col items-start gap-0.5 px-2.5 py-2 text-left hover:bg-white/[0.07] active:bg-white/[0.04]"
                onClick={() => void onExportPickFormat('obj')}
              >
                <span className="font-semibold text-gray-100">OBJ</span>
                <span className="text-[9px] leading-snug text-gray-500">仅几何，无材质贴图</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full flex-col items-start gap-0.5 px-2.5 py-2 text-left hover:bg-white/[0.07] active:bg-white/[0.04]"
                onClick={() => void onExportPickFormat('stl')}
              >
                <span className="font-semibold text-gray-100">STL（二进制）</span>
                <span className="text-[9px] leading-snug text-gray-500">3D 打印 / 布尔常用</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full flex-col items-start gap-0.5 px-2.5 py-2 text-left hover:bg-white/[0.07] active:bg-white/[0.04]"
                onClick={() => void onExportPickFormat('fbx')}
              >
                <span className="font-semibold text-gray-100">FBX（二进制）</span>
                <span className="text-[9px] leading-snug text-gray-500">DCC / 引擎常用交换格式</span>
              </button>
            </div>
          ) : null}
        </div>
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
          className="pointer-events-auto flex w-full min-w-0 flex-col gap-2 text-[9px] text-gray-300 sm:text-[10px]"
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
