/**
 * 贴图修缝：优先浏览器内 Pyodide（无需后端），可选回退到 Python 后端
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { seamRepairWithFallback, seamRepairHealth, type SeamRepairParams } from '../services/seamRepairService';
import { getCompanionLocalBaseUrl, normalizeCompanionBaseUrl } from '../services/companionLocalPrefs';
import {
  createCompanionJobEventStream,
  fetchCompanionAssetBlob,
  listCompanionJobEvents,
  putCompanionAsset,
  submitCompanionSeamRepairJob,
  type CompanionJobEventV1,
} from '../services/companionClient';
import {
  clearCompanionJobCursor,
  getCompanionJobCursor,
  setCompanionJobCursor,
} from '../services/companionJobCursorStore';
import {
  clearCompanionJobTerminalEvent,
  getCompanionJobTerminalEvent,
  saveCompanionJobTerminalEvent,
} from '../services/companionJobTerminalStore';
import { companionJobStatusHuman } from '../services/companionJobStatusHuman';
import { SiteImage } from './SiteImage';

// OBJ + 贴图 3D 预览（仅影响预览，不改变修复结果）
const ObjTextureViewer: React.FC<{
  objText: string | null;
  textureUrl: string | null;
  flipX: boolean;
  flipY: boolean;
  rotateDeg: number;
  className?: string;
}> = ({ objText, textureUrl, flipX, flipY, rotateDeg, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const animIdRef = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 320;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a12);
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
    camera.position.set(1.6, 1.2, 1.6);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(2.5, 3.5, 2);
    scene.add(dir);
    const grid = new THREE.GridHelper(4, 8, 0x3a4a62, 0x1b2635);
    (grid.material as THREE.Material).opacity = 0.25;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;

    function animate() {
      animIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight || 320;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animIdRef.current);
      renderer.dispose();
      controls.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;
    if (!objText) {
      if (rootRef.current) {
        scene.remove(rootRef.current);
        rootRef.current = null;
      }
      return;
    }
    const loader = new OBJLoader();
    try {
      const root = loader.parse(objText);
      root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry) o.geometry.computeVertexNormals();
      });
      if (rootRef.current) scene.remove(rootRef.current);
      rootRef.current = root;
      scene.add(root);
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
    } catch {
      if (rootRef.current) scene.remove(rootRef.current);
      rootRef.current = null;
    }
  }, [objText]);

  useEffect(() => {
    const scene = sceneRef.current;
    const root = rootRef.current;
    if (!scene || !root) return;
    const mat = materialRef.current || new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
    if (!materialRef.current) materialRef.current = mat;
    if (textureUrl) {
      fetch(textureUrl)
        .then((r) => r.blob())
        .then((blob) => createImageBitmap(blob))
        .then((bitmap) => {
          const tex = new THREE.Texture(bitmap);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = true;
          tex.center.set(0.5, 0.5);
          tex.rotation = (rotateDeg * Math.PI) / 180;
          tex.repeat.set(flipX ? -1 : 1, flipY ? -1 : 1);
          tex.offset.set(flipX ? 1 : 0, flipY ? 1 : 0);
          tex.needsUpdate = true;
          if (mat.map) mat.map.dispose?.();
          mat.map = tex;
          mat.needsUpdate = true;
          root.traverse((o) => {
            if (o instanceof THREE.Mesh) o.material = mat;
          });
        })
        .catch(() => {});
    } else {
      if (mat.map) {
        mat.map.dispose?.();
        mat.map = null;
      }
      mat.needsUpdate = true;
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.material = mat;
      });
    }
  }, [textureUrl, flipX, flipY, rotateDeg]);

  return <div ref={containerRef} className={className} style={{ minHeight: 280 }} />;
};

const DEFAULT_PARAMS: SeamRepairParams = {
  texture_kind: 'basecolor',
  band_px: 8,
  feather_px: 6,
  sample_step_px: 2,
  mode: 'average',
  only_masked_seams: true,
  alpha_method: 'distance',
  alpha_edge_aware: true,
  guided_eps: 1e-4,
  color_match: 'meanvar',
  poisson_iters: 0,
};

const COMPANION_STREAM_STATE_KEY = 'ac_companion_seam_stream_state_v2';
const TERMINAL_JOB_EVENT_TYPES = new Set<CompanionJobEventV1['type']>([
  'reply.completed',
  'task.failed',
  'task.cancelled',
]);

const SeamRepairSection: React.FC<{ onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void }> = ({ onLog }) => {
  const [objFile, setObjFile] = useState<File | null>(null);
  const [objText, setObjText] = useState<string | null>(null);
  const [texFile, setTexFile] = useState<File | null>(null);
  const [texPreviewUrl, setTexPreviewUrl] = useState<string | null>(null);
  const [maskFile, setMaskFile] = useState<File | null>(null);
  const [params, setParams] = useState<SeamRepairParams>(DEFAULT_PARAMS);
  const [previewFlipX, setPreviewFlipX] = useState(false);
  const [previewFlipY, setPreviewFlipY] = useState(false);
  const [previewRotate, setPreviewRotate] = useState(0);
  const [status, setStatus] = useState('请上传 OBJ 与贴图');
  const [repairing, setRepairing] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [useResultTex, setUseResultTex] = useState(true);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [companionJobId, setCompanionJobId] = useState('');
  const [companionProjectId, setCompanionProjectId] = useState('demo-seam');
  const [companionSubmitBusy, setCompanionSubmitBusy] = useState(false);
  const [companionEvents, setCompanionEvents] = useState<CompanionJobEventV1[]>([]);
  const [companionAfterSeq, setCompanionAfterSeq] = useState(0);
  const [companionEventsBusy, setCompanionEventsBusy] = useState(false);
  const [companionEventsHint, setCompanionEventsHint] = useState('');
  const [companionEventsAuto, setCompanionEventsAuto] = useState(false);
  const [companionStreamMode, setCompanionStreamMode] = useState<'idle' | 'sse' | 'poll'>('idle');
  const resultUrlRef = useRef<string | null>(null);
  const repairAbortRef = useRef<AbortController | null>(null);
  const lastCompanionOutputLoadedRef = useRef<string>('');
  const companionOutputFetchBusyRef = useRef(false);

  useEffect(() => {
    seamRepairHealth()
      .then(() => setBackendAvailable(true))
      .catch(() => setBackendAvailable(false));
  }, []);

  useEffect(() => {
    lastCompanionOutputLoadedRef.current = '';
  }, [companionJobId]);

  useEffect(() => {
    try {
      const raw = globalThis.localStorage?.getItem(COMPANION_STREAM_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        projectId?: string;
        jobId?: string;
        afterSeq?: number;
        auto?: boolean;
      };
      if (parsed.projectId) setCompanionProjectId(parsed.projectId);
      if (parsed.jobId) setCompanionJobId(parsed.jobId);
      if (Number.isFinite(parsed.afterSeq)) setCompanionAfterSeq(Math.max(0, Math.floor(parsed.afterSeq ?? 0)));
      if (typeof parsed.auto === 'boolean') setCompanionEventsAuto(parsed.auto);
      if (parsed.jobId) {
        const sharedCursor = getCompanionJobCursor(parsed.jobId);
        if (sharedCursor > 0) setCompanionAfterSeq((prev) => Math.max(prev, sharedCursor));
        const snap = getCompanionJobTerminalEvent(parsed.jobId);
        if (snap && TERMINAL_JOB_EVENT_TYPES.has(snap.type)) {
          setCompanionEvents([snap]);
          setCompanionAfterSeq((prev) => Math.max(prev, snap.seq));
        }
      }
    } catch {
      /* ignore malformed session state */
    }
  }, []);

  useEffect(() => {
    try {
      const payload = JSON.stringify({
        projectId: companionProjectId.trim(),
        jobId: companionJobId.trim(),
        afterSeq: companionAfterSeq,
        auto: companionEventsAuto,
      });
      globalThis.localStorage?.setItem(COMPANION_STREAM_STATE_KEY, payload);
      const jid = companionJobId.trim();
      if (jid) setCompanionJobCursor(jid, companionAfterSeq);
    } catch {
      /* ignore */
    }
  }, [companionAfterSeq, companionEventsAuto, companionJobId, companionProjectId]);

  const revokeResult = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      repairAbortRef.current?.abort();
      revokeResult();
    };
  }, [revokeResult]);

  const onObjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setObjFile(f);
    f.text().then(setObjText).catch(() => setObjText(null));
  };

  const texPreviewUrlRef = useRef<string | null>(null);
  const onTexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (texPreviewUrlRef.current) URL.revokeObjectURL(texPreviewUrlRef.current);
    setTexFile(f);
    revokeResult();
    setResultUrl(null);
    const u = URL.createObjectURL(f);
    texPreviewUrlRef.current = u;
    setTexPreviewUrl(u);
  };

  const onMaskChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setMaskFile(f || null);
  };

  const handleRepair = async () => {
    if (!objFile || !texFile) {
      setStatus('请先选择 OBJ 与贴图');
      onLog?.('warn', '请先选择 OBJ 与贴图');
      return;
    }
    repairAbortRef.current?.abort();
    const controller = new AbortController();
    repairAbortRef.current = controller;
    setStatus('修复中…（首次将加载约 10MB 运行环境，仅此一次）');
    setRepairing(true);
    onLog?.('info', '贴图修缝：开始修复（浏览器内计算）');
    try {
      const { blob, mode } = await seamRepairWithFallback(objFile, texFile, maskFile, params, { signal: controller.signal });
      revokeResult();
      const url = URL.createObjectURL(blob);
      resultUrlRef.current = url;
      setResultUrl(url);
      setUseResultTex(true);
      setStatus(mode === 'pyodide' ? '修复完成（浏览器内计算）。可对比 2D/3D 并下载。' : '修复完成（后端计算）。可对比 2D/3D 并下载。');
      onLog?.('info', `贴图修缝：修复完成（${mode === 'pyodide' ? '浏览器内' : '后端'}）`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && e.name === 'AbortError') {
        setStatus(msg);
        onLog?.('warn', '贴图修缝已取消', msg);
      } else {
        setStatus(`修复失败：${msg}`);
        onLog?.('error', '贴图修缝失败', msg);
      }
    } finally {
      if (repairAbortRef.current === controller) {
        repairAbortRef.current = null;
      }
      setRepairing(false);
    }
  };

  const handleCancelRepair = useCallback(() => {
    repairAbortRef.current?.abort();
  }, []);

  const currentTexUrl = (useResultTex && resultUrl) ? resultUrl : texPreviewUrl;

  const pullCompanionEvents = useCallback(
    async (resetCursor = false) => {
      const jobId = companionJobId.trim();
      if (!jobId) {
        setCompanionEventsHint('请先填写任务编号');
        return;
      }
      setCompanionEventsBusy(true);
      setCompanionEventsHint('');
      const sharedCursor = getCompanionJobCursor(jobId);
      const afterSeq = resetCursor ? 0 : Math.max(companionAfterSeq, sharedCursor);
      if (resetCursor) {
        setCompanionEvents([]);
        setCompanionAfterSeq(0);
        clearCompanionJobCursor(jobId);
        clearCompanionJobTerminalEvent(jobId);
        lastCompanionOutputLoadedRef.current = '';
      }
      try {
        const base = normalizeCompanionBaseUrl(getCompanionLocalBaseUrl());
        const r = await listCompanionJobEvents(base, jobId, afterSeq, 80);
        if (r.ok === false) {
          setCompanionEventsHint(`拉取失败：${r.error}${r.status != null ? `（HTTP ${r.status}）` : ''}`);
          return;
        }
        const incoming = Array.isArray(r.data.events) ? r.data.events : [];
        if (incoming.length) {
          setCompanionEvents((prev) => {
            const seen = new Set(prev.map((e) => e.seq));
            const merged = [...prev, ...incoming.filter((e) => !seen.has(e.seq))];
            return merged.sort((a, b) => a.seq - b.seq).slice(-300);
          });
        }
        const next = r.data.nextAfterSeq ?? afterSeq;
        setCompanionAfterSeq(next);
        setCompanionJobCursor(jobId, next);
        setCompanionEventsHint(
          incoming.length
            ? `已同步 ${incoming.length} 条进度${r.latencyMs != null ? `（${r.latencyMs}ms）` : ''}`
            : `进度已是最新${r.latencyMs != null ? `（${r.latencyMs}ms）` : ''}`,
        );
      } catch (e) {
        setCompanionEventsHint(`拉取异常：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setCompanionEventsBusy(false);
      }
    },
    [companionAfterSeq, companionJobId],
  );

  const submitToCompanionAndTrack = useCallback(async () => {
    if (!objFile || !texFile) {
      setCompanionEventsHint('请先选择 OBJ 与贴图');
      return;
    }
    const projectId = companionProjectId.trim();
    if (!projectId) {
      setCompanionEventsHint('请先填写本机项目名');
      return;
    }
    setCompanionSubmitBusy(true);
    setCompanionEventsHint('');
    try {
      const base = normalizeCompanionBaseUrl(getCompanionLocalBaseUrl());
      const stamp = Date.now();
      const objKey = `seam_obj_${stamp}`;
      const texKey = `seam_tex_${stamp}`;
      const maskKey = maskFile ? `seam_mask_${stamp}` : undefined;
      const outKey = `seam_out_${stamp}`;

      const putObj = await putCompanionAsset(base, projectId, objKey, objFile, 'model/obj');
      if (putObj.ok === false) {
        setCompanionEventsHint(`上传 OBJ 失败：${putObj.error}${putObj.status != null ? `（HTTP ${putObj.status}）` : ''}`);
        return;
      }
      const putTex = await putCompanionAsset(base, projectId, texKey, texFile, texFile.type || 'image/png');
      if (putTex.ok === false) {
        setCompanionEventsHint(`上传贴图失败：${putTex.error}${putTex.status != null ? `（HTTP ${putTex.status}）` : ''}`);
        return;
      }
      if (maskFile && maskKey) {
        const putMask = await putCompanionAsset(base, projectId, maskKey, maskFile, maskFile.type || 'image/png');
        if (putMask.ok === false) {
          setCompanionEventsHint(`上传 mask 失败：${putMask.error}${putMask.status != null ? `（HTTP ${putMask.status}）` : ''}`);
          return;
        }
      }

      const submit = await submitCompanionSeamRepairJob(
        base,
        projectId,
        { objKey, textureKey: texKey, maskKey, outputKey: outKey },
        params as Record<string, unknown>,
      );
      if (submit.ok === false) {
        setCompanionEventsHint(`提交任务失败：${submit.error}${submit.status != null ? `（HTTP ${submit.status}）` : ''}`);
        return;
      }

      const jid = submit.data.jobId;
      setCompanionJobId(jid);
      setCompanionEvents([]);
      setCompanionAfterSeq(0);
      setCompanionEventsAuto(true);
      setCompanionEventsHint('已提交到本机处理，将自动显示进度');
      // 立即拉一次，用户可立刻看到 accepted/running
      window.setTimeout(() => {
        void pullCompanionEvents(true);
      }, 50);
    } catch (e) {
      setCompanionEventsHint(`提交异常：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCompanionSubmitBusy(false);
    }
  }, [companionProjectId, maskFile, objFile, params, pullCompanionEvents, texFile]);

  const openCompanionConsole = useCallback(() => {
    const base = normalizeCompanionBaseUrl(getCompanionLocalBaseUrl());
    window.open(`${base}/`, '_blank', 'noopener,noreferrer');
  }, []);

  const copyCompanionDiagnostics = useCallback(async () => {
    const latest = companionEvents.length ? companionEvents[companionEvents.length - 1] : null;
    const content = JSON.stringify(
      {
        projectId: companionProjectId.trim(),
        jobId: companionJobId.trim(),
        cursor: companionAfterSeq,
        hint: companionEventsHint,
        latestEvent: latest,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(content);
      setCompanionEventsHint('已复制诊断信息');
    } catch {
      setCompanionEventsHint('复制失败：浏览器未授予剪贴板权限');
    }
  }, [companionAfterSeq, companionEvents, companionEventsHint, companionJobId, companionProjectId]);

  const applyCompanionRepairOutput = useCallback(
    async (outputKey: string, token: string, opts?: { force?: boolean }) => {
      const pid = companionProjectId.trim();
      if (!pid) {
        setCompanionEventsHint('请先填写本机项目名');
        return;
      }
      if (opts?.force) lastCompanionOutputLoadedRef.current = '';
      if (!opts?.force && lastCompanionOutputLoadedRef.current === token) return;
      if (companionOutputFetchBusyRef.current) return;
      companionOutputFetchBusyRef.current = true;
      try {
        const base = normalizeCompanionBaseUrl(getCompanionLocalBaseUrl());
        const r = await fetchCompanionAssetBlob(base, pid, outputKey);
        if (r.ok === false) {
          setCompanionEventsHint(
            `加载伴侣输出失败：${r.error}${r.status != null ? `（HTTP ${r.status}）` : ''}`,
          );
          return;
        }
        const blob = new Blob([r.data], { type: 'image/png' });
        revokeResult();
        const url = URL.createObjectURL(blob);
        resultUrlRef.current = url;
        setResultUrl(url);
        setUseResultTex(true);
        lastCompanionOutputLoadedRef.current = token;
        setCompanionEventsHint(
          `已从伴侣加载输出贴图（key=${outputKey}）${r.latencyMs != null ? ` ${r.latencyMs}ms` : ''}`,
        );
        setStatus('已从本地伴侣拉回修复贴图，可 2D/3D 预览与下载。');
      } finally {
        companionOutputFetchBusyRef.current = false;
      }
    },
    [companionProjectId, revokeResult],
  );

  useEffect(() => {
    const latest = companionEvents.length ? companionEvents[companionEvents.length - 1] : null;
    if (!latest || latest.type !== 'reply.completed') return;
    const raw = latest.payload?.outputKey;
    if (raw == null || typeof raw !== 'string' || !raw.trim()) return;
    const token = `${latest.jobId}:${latest.seq}`;
    void applyCompanionRepairOutput(raw.trim(), token);
  }, [companionEvents, applyCompanionRepairOutput]);

  useEffect(() => {
    if (!companionEventsAuto) {
      setCompanionStreamMode('idle');
      return;
    }
    const jobId = companionJobId.trim();
    if (!jobId) return;
    const base = normalizeCompanionBaseUrl(getCompanionLocalBaseUrl());
    const afterSeq = Math.max(companionAfterSeq, getCompanionJobCursor(jobId));
    const stream = createCompanionJobEventStream(base, jobId, afterSeq);
    let closed = false;
    setCompanionStreamMode('sse');
    setCompanionEventsHint((prev) => prev || '已连接实时进度');

    const onJobEvent = (ev: MessageEvent) => {
      let parsed: CompanionJobEventV1 | null = null;
      try {
        parsed = JSON.parse(ev.data) as CompanionJobEventV1;
      } catch {
        return;
      }
      if (!parsed || typeof parsed.seq !== 'number') return;
      setCompanionEvents((prev) => {
        const seen = new Set(prev.map((e) => e.seq));
        const merged = seen.has(parsed.seq) ? prev : [...prev, parsed];
        return merged.sort((a, b) => a.seq - b.seq).slice(-300);
      });
      const seq = parsed.seq;
      setCompanionAfterSeq((prev) => {
        const next = Math.max(prev, seq);
        setCompanionJobCursor(jobId, next);
        return next;
      });
    };
    const onJobEnd = () => {
      setCompanionEventsHint('任务已结束');
      setCompanionStreamMode('idle');
      stream.close();
    };
    const onError = () => {
      if (closed) return;
      setCompanionStreamMode('poll');
      setCompanionEventsHint('实时连接不可用，已改为定时刷新');
      stream.close();
    };
    stream.addEventListener('job.event', onJobEvent as EventListener);
    stream.addEventListener('job.end', onJobEnd as EventListener);
    stream.onerror = onError;
    return () => {
      closed = true;
      stream.removeEventListener('job.event', onJobEvent as EventListener);
      stream.removeEventListener('job.end', onJobEnd as EventListener);
      stream.close();
    };
  }, [companionAfterSeq, companionEventsAuto, companionJobId]);

  useEffect(() => {
    if (!companionEventsAuto) return;
    if (companionStreamMode === 'sse') return;
    if (!companionJobId.trim()) return;
    setCompanionStreamMode('poll');
    const t = window.setInterval(() => {
      void pullCompanionEvents(false);
    }, 2500);
    return () => window.clearInterval(t);
  }, [companionEventsAuto, companionJobId, companionStreamMode, pullCompanionEvents]);

  useEffect(() => {
    const latest = companionEvents.length ? companionEvents[companionEvents.length - 1] : null;
    if (!latest || !TERMINAL_JOB_EVENT_TYPES.has(latest.type)) return;
    if (!companionEventsAuto) return;
    setCompanionEventsAuto(false);
    setCompanionStreamMode('idle');
    setCompanionEventsHint('任务已结束，已停止自动跟随');
  }, [companionEvents, companionEventsAuto]);

  useEffect(() => {
    const latest = companionEvents.length ? companionEvents[companionEvents.length - 1] : null;
    if (!latest || !TERMINAL_JOB_EVENT_TYPES.has(latest.type)) return;
    saveCompanionJobTerminalEvent(latest);
  }, [companionEvents]);

  useEffect(() => {
    if (!companionJobId.trim()) return;
    if (companionEvents.length > 0) return;
    void pullCompanionEvents(false);
  }, [companionEvents.length, companionJobId, pullCompanionEvents]);

  const latestCompanionEvent = companionEvents.length ? companionEvents[companionEvents.length - 1] : null;
  const companionFailed = latestCompanionEvent?.type === 'task.failed';
  const companionCompleted = latestCompanionEvent?.type === 'reply.completed';

  return (
    <div className="flex h-[calc(100dvh-6rem)] gap-4 lg:gap-6 animate-in fade-in overflow-hidden flex-col">
      {backendAvailable === false && (
        <div className="shrink-0 rounded-xl border border-[#3b6fb8] bg-[#1a3354] px-4 py-3 text-[11px] text-blue-200">
          <strong>当前使用浏览器内计算（Pyodide）</strong>，无需后端即可修缝。若需更快或更稳，可启动 Python 后端：<code className="bg-[#141416] px-1 rounded">npm run dev:seam-backend</code>，并配置 <code className="bg-[#141416] px-1 rounded">VITE_SEAM_REPAIR_API</code>。
        </div>
      )}
      <div className="flex flex-1 min-h-0 gap-4 lg:gap-6 overflow-hidden">
      {/* 左侧：输入与参数 */}
      <div className="w-80 lg:w-96 shrink-0 flex flex-col gap-4 overflow-y-auto no-scrollbar pr-2">
        <div className="glass rounded-2xl p-4 lg:p-6 border border-[#2e2e32] bg-[#16161a]">
          <div className="text-[9px] font-black text-gray-500 uppercase mb-3">输入</div>
          <label className="block mb-3">
            <span className="text-[10px] font-black text-gray-400 uppercase">OBJ（含 vt UV）</span>
            <input type="file" accept=".obj" onChange={onObjChange} className="mt-1 w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:bg-[#264670] file:text-blue-300" />
          </label>
          <label className="block mb-3">
            <span className="text-[10px] font-black text-gray-400 uppercase">贴图（BaseColor 等）</span>
            <input type="file" accept="image/*" onChange={onTexChange} className="mt-1 w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:bg-[#264670] file:text-blue-300" />
          </label>
          <label className="block mb-4">
            <span className="text-[10px] font-black text-gray-400 uppercase">Seam Mask（可选）</span>
            <input type="file" accept="image/*" onChange={onMaskChange} className="mt-1 w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:bg-[#264670] file:text-blue-300" />
          </label>

          <div className="text-[9px] font-black text-gray-500 uppercase mb-2">参数</div>
          <div className="space-y-2 mb-4">
            <div>
              <span className="text-[9px] text-gray-500">贴图类型</span>
              <select value={params.texture_kind} onChange={(e) => setParams((p) => ({ ...p, texture_kind: e.target.value }))} className="w-full mt-0.5 bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors">
                <option value="basecolor">BaseColor（sRGB）</option>
                <option value="data">数据贴图（线性）</option>
                <option value="normal">Normal（向量法线）</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[9px] text-gray-500">带宽(px)</span>
                <input type="number" min={1} max={64} value={params.band_px} onChange={(e) => setParams((p) => ({ ...p, band_px: Number(e.target.value) || 8 }))} className="w-full mt-0.5 bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors" />
              </div>
              <div>
                <span className="text-[9px] text-gray-500">过渡(px)</span>
                <input type="number" min={0} max={64} value={params.feather_px} onChange={(e) => setParams((p) => { const nextValue = Number(e.target.value); return { ...p, feather_px: Number.isFinite(nextValue) ? nextValue : 6 }; })} className="w-full mt-0.5 bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors" />
              </div>
            </div>
            <div>
              <span className="text-[9px] text-gray-500">沿边步长(px)</span>
                <input type="number" min={0.25} max={16} step={0.25} value={params.sample_step_px} onChange={(e) => setParams((p) => ({ ...p, sample_step_px: Number(e.target.value) || 2 }))} className="w-full mt-0.5 bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors" />
            </div>
            <div>
              <span className="text-[9px] text-gray-500">模式</span>
              <select value={params.mode} onChange={(e) => setParams((p) => ({ ...p, mode: e.target.value }))} className="w-full mt-0.5 bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors">
                <option value="average">双向平均（推荐）</option>
                <option value="a_to_b">A → B</option>
                <option value="b_to_a">B → A</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-[10px] cursor-pointer">
              <input type="checkbox" checked={params.only_masked_seams} onChange={(e) => setParams((p) => ({ ...p, only_masked_seams: e.target.checked }))} className="rounded" />
              <span>只修复 Mask 覆盖的 seam</span>
            </label>
            <div>
              <span className="text-[9px] text-gray-500">Alpha 方式</span>
              <select value={params.alpha_method} onChange={(e) => setParams((p) => ({ ...p, alpha_method: e.target.value }))} className="w-full mt-0.5 bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors">
                <option value="distance">距离场（推荐）</option>
                <option value="wacc">采样权重</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-[10px] cursor-pointer">
              <input type="checkbox" checked={params.alpha_edge_aware} onChange={(e) => setParams((p) => ({ ...p, alpha_edge_aware: e.target.checked }))} className="rounded" />
              <span>边缘保持（引导滤波）</span>
            </label>
            <div>
              <span className="text-[9px] text-gray-500">颜色匹配</span>
              <select value={params.color_match} onChange={(e) => setParams((p) => ({ ...p, color_match: e.target.value }))} className="w-full mt-0.5 bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors">
                <option value="meanvar">均值/方差（推荐）</option>
                <option value="meanvar_edge">按边（可能出色块）</option>
                <option value="none">关闭</option>
              </select>
            </div>
            <div>
              <span className="text-[9px] text-gray-500">Poisson 迭代</span>
                <input type="number" min={0} max={200} step={25} value={params.poisson_iters} onChange={(e) => setParams((p) => ({ ...p, poisson_iters: Number(e.target.value) || 0 }))} className="w-full mt-0.5 bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors" />
            </div>
          </div>

          <div className="text-[9px] font-black text-gray-500 uppercase mb-2">3D 预览贴图校正（仅预览）</div>
          <div className="flex flex-wrap gap-2 mb-4">
            <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
              <input type="checkbox" checked={previewFlipX} onChange={(e) => setPreviewFlipX(e.target.checked)} className="rounded" />
              <span>左右翻转</span>
            </label>
            <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
              <input type="checkbox" checked={previewFlipY} onChange={(e) => setPreviewFlipY(e.target.checked)} className="rounded" />
              <span>上下翻转</span>
            </label>
            <select value={previewRotate} onChange={(e) => setPreviewRotate(Number(e.target.value))} className="bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors">
              <option value={0}>0°</option>
              <option value={90}>90°</option>
              <option value={180}>180°</option>
              <option value={270}>270°</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button onClick={handleRepair} disabled={repairing || !objFile || !texFile} className="flex-1 py-2.5 bg-blue-600 rounded-xl text-[10px] font-black uppercase electric-glow disabled:opacity-40">
              {repairing ? '修复中…' : '开始修复'}
            </button>
            {repairing && (
              <button type="button" onClick={handleCancelRepair} className="px-4 py-2.5 border border-[#343438] rounded-xl text-[10px] font-black uppercase text-gray-300 hover:bg-[#222228]">
                取消
              </button>
            )}
          </div>
          {resultUrl && (
            <a href={resultUrl} download="repaired.png" className="mt-3 w-full py-2 border border-[#3b82f6] rounded-xl text-[10px] font-black uppercase text-blue-300 text-center inline-block hover:bg-[#284d78]">
              下载修复图
            </a>
          )}
          <div className="mt-3 text-[9px] text-gray-500 min-h-[2rem]">{status}</div>
        </div>
      </div>

      {/* 右侧：上 2D 对比，下 3D 预览（两列布局，右侧单列上下排） */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-hidden">
        <div className="glass rounded-2xl p-4 border border-[#2e2e32] bg-[#16161a] shrink-0">
          <div className="text-[9px] font-black text-gray-500 uppercase mb-2">2D 对比</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] text-gray-500 mb-1">原图</div>
              <div className="rounded-xl border border-[#2e2e32] bg-[#16161a] overflow-hidden h-[140px] flex items-center justify-center">
                {texPreviewUrl ? <SiteImage src={texPreviewUrl} alt="原图" className="max-w-full max-h-full object-contain" /> : <span className="text-[9px] text-gray-600">—</span>}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-gray-500 mb-1">修复后</div>
              <div className="rounded-xl border border-[#2e2e32] bg-[#16161a] overflow-hidden h-[140px] flex items-center justify-center">
                {resultUrl ? <SiteImage src={resultUrl} alt="修复后" className="max-w-full max-h-full object-contain" /> : <span className="text-[9px] text-gray-600">—</span>}
              </div>
            </div>
          </div>
        </div>
        <div className="glass rounded-2xl p-4 border border-[#2e2e32] bg-[#16161a] flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-black text-gray-500 uppercase">3D 预览（OBJ）</span>
            {resultUrl && texPreviewUrl && (
              <button type="button" onClick={() => setUseResultTex((u) => !u)} className="text-[9px] font-black uppercase text-blue-400 hover:text-blue-300 border border-[#3b6fb8] rounded-lg px-2 py-1">
                {useResultTex ? '切到原图' : '切到修复后'}
              </button>
            )}
          </div>
          <div className="flex-1 rounded-xl border border-[#2e2e32] overflow-hidden min-h-[240px] bg-[#0a0a12]">
            <ObjTextureViewer objText={objText} textureUrl={currentTexUrl} flipX={previewFlipX} flipY={previewFlipY} rotateDeg={previewRotate} className="w-full h-full" />
          </div>
          <div className="text-[9px] text-gray-500 mt-1">鼠标左键旋转、滚轮缩放</div>
        </div>
        <footer className="text-[9px] text-gray-500 shrink-0">
          若接缝是<strong className="text-gray-400">法线/切线空间</strong>导致的「光照裂」，修 BaseColor 不会治本；本工具主要解决贴图跨缝不一致。
        </footer>
        <div className="glass rounded-2xl p-4 border border-[#2e2e32] bg-[#16161a] shrink-0">
          <div className="text-[10px] font-bold text-gray-300 mb-1">在本机完成修缝（可选）</div>
          <p className="text-[9px] text-gray-500 mb-3 leading-relaxed">
            若已安装本地伴侣，可一键把当前 OBJ/贴图传到本机处理；完成后修复图会自动出现在上方预览。
          </p>
          <input
            type="text"
            value={companionProjectId}
            onChange={(e) => setCompanionProjectId(e.target.value)}
            placeholder="本机项目名（可保留默认）"
            className="w-full px-3 py-2 rounded-xl bg-[#101014] border border-[#2e2e32] text-[11px] text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none mb-2"
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void submitToCompanionAndTrack()}
              disabled={companionSubmitBusy}
              className="px-3 py-1.5 rounded-lg border border-[#3b82f6] text-[10px] font-bold text-blue-300 hover:bg-[#1d3e66] transition-colors disabled:opacity-60"
            >
              {companionSubmitBusy ? '提交中…' : '上传到本机修缝'}
            </button>
            {companionCompleted &&
            typeof latestCompanionEvent?.payload?.outputKey === 'string' &&
            latestCompanionEvent.payload.outputKey.trim() ? (
              <button
                type="button"
                onClick={() => {
                  const latest = companionEvents.length ? companionEvents[companionEvents.length - 1] : null;
                  const key = latest?.payload?.outputKey;
                  if (typeof key === 'string' && key.trim() && latest) {
                    void applyCompanionRepairOutput(key.trim(), `${latest.jobId}:${latest.seq}`, { force: true });
                  }
                }}
                className="px-3 py-1.5 rounded-lg border border-[#3b82f6] text-[10px] font-bold text-blue-300 hover:bg-[#1d3e66] transition-colors"
              >
                重新载入本机结果
              </button>
            ) : null}
          </div>
          {latestCompanionEvent ? (
            <p className="text-[10px] text-gray-300 mt-2">
              本机任务：<span className="text-white">{companionJobStatusHuman(latestCompanionEvent)}</span>
            </p>
          ) : null}
          {companionEventsHint ? <p className="text-[10px] text-gray-400 mt-1">{companionEventsHint}</p> : null}
          {(companionFailed || companionCompleted) ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {companionFailed ? (
                <button
                  type="button"
                  onClick={() => void submitToCompanionAndTrack()}
                  disabled={companionSubmitBusy}
                  className="px-3 py-1.5 rounded-lg border border-[#b45309] text-[10px] font-bold text-amber-300 hover:bg-[#3a2a12] transition-colors disabled:opacity-60"
                >
                  再试一次
                </button>
              ) : null}
              <button
                type="button"
                onClick={openCompanionConsole}
                className="px-3 py-1.5 rounded-lg border border-[#2e2e32] text-[10px] font-bold text-gray-200 hover:bg-[#222228] transition-colors"
              >
                打开本机管理页
              </button>
              <button
                type="button"
                onClick={() => void copyCompanionDiagnostics()}
                className="px-3 py-1.5 rounded-lg border border-[#2e2e32] text-[10px] font-bold text-gray-200 hover:bg-[#222228] transition-colors"
              >
                复制诊断信息
              </button>
            </div>
          ) : null}
          <details className="mt-3 rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
            <summary className="cursor-pointer text-[9px] font-bold text-gray-500 list-none marker:content-none [&::-webkit-details-marker]:hidden">
              高级：任务编号与详细日志
            </summary>
            <input
              type="text"
              value={companionJobId}
              onChange={(e) => setCompanionJobId(e.target.value)}
              placeholder="任务编号（一般无需填写）"
              className="w-full px-3 py-2 rounded-xl bg-[#0c0c10] border border-[#2e2e32] text-[11px] text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none mt-2"
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                onClick={() => void pullCompanionEvents(true)}
                disabled={companionEventsBusy || companionSubmitBusy}
                className="px-3 py-1.5 rounded-lg bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors disabled:opacity-60"
              >
                {companionEventsBusy ? '刷新中…' : '从头刷新'}
              </button>
              <button
                type="button"
                onClick={() => void pullCompanionEvents(false)}
                disabled={companionEventsBusy || companionSubmitBusy}
                className="px-3 py-1.5 rounded-lg bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors disabled:opacity-60"
              >
                仅看新进度
              </button>
              <button
                type="button"
                onClick={() => setCompanionEventsAuto((v) => !v)}
                className="px-3 py-1.5 rounded-lg border border-[#2e2e32] text-[10px] font-bold text-gray-200 hover:bg-[#222228] transition-colors"
              >
                {companionEventsAuto ? '停止自动跟随' : '自动跟随进度'}
              </button>
            </div>
            <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-36 overflow-y-auto">
              {companionEvents.length ? JSON.stringify(companionEvents.slice(-80), null, 2) : '（暂无）'}
            </pre>
          </details>
        </div>
      </div>
      </div>
    </div>
  );
};

export default SeamRepairSection;
