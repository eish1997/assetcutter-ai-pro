/**
 * 贴图修缝：优先浏览器内 Pyodide（无需后端），可选回退到 Python 后端
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { seamRepairWithFallback, seamRepairHealth, type SeamRepairParams } from '../services/seamRepairService';

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
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth || 400;
    const height = containerRef.current.clientHeight || 320;
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
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);
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
      cancelAnimationFrame(animIdRef.current);
      renderer.dispose();
      controls.dispose();
      if (containerRef.current?.contains(renderer.domElement)) containerRef.current.removeChild(renderer.domElement);
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
    } catch (_) {
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
  const resultUrlRef = useRef<string | null>(null);

  useEffect(() => {
    seamRepairHealth()
      .then(() => setBackendAvailable(true))
      .catch(() => setBackendAvailable(false));
  }, []);

  const revokeResult = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => revokeResult();
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
    setStatus('修复中…（首次将加载约 10MB 运行环境，仅此一次）');
    setRepairing(true);
    onLog?.('info', '贴图修缝：开始修复（浏览器内计算）');
    try {
      const { blob, mode } = await seamRepairWithFallback(objFile, texFile, maskFile, params);
      revokeResult();
      const url = URL.createObjectURL(blob);
      resultUrlRef.current = url;
      setResultUrl(url);
      setUseResultTex(true);
      setStatus(mode === 'pyodide' ? '修复完成（浏览器内计算）。可对比 2D/3D 并下载。' : '修复完成（后端计算）。可对比 2D/3D 并下载。');
      onLog?.('info', `贴图修缝：修复完成（${mode === 'pyodide' ? '浏览器内' : '后端'}）`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`修复失败：${msg}`);
      onLog?.('error', '贴图修缝失败', msg);
    } finally {
      setRepairing(false);
    }
  };

  const currentTexUrl = (useResultTex && resultUrl) ? resultUrl : texPreviewUrl;

  return (
    <div className="flex h-[calc(100dvh-6rem)] gap-4 lg:gap-6 animate-in fade-in overflow-hidden flex-col">
      {backendAvailable === false && (
        <div className="shrink-0 rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-[11px] text-blue-200">
          <strong>当前使用浏览器内计算（Pyodide）</strong>，无需后端即可修缝。若需更快或更稳，可启动 Python 后端：<code className="bg-black/30 px-1 rounded">npm run dev:seam-backend</code>，并配置 <code className="bg-black/30 px-1 rounded">VITE_SEAM_REPAIR_API</code>。
        </div>
      )}
      <div className="flex flex-1 min-h-0 gap-4 lg:gap-6 overflow-hidden">
      {/* 左侧：输入与参数 */}
      <div className="w-80 lg:w-96 shrink-0 flex flex-col gap-4 overflow-y-auto no-scrollbar pr-2">
        <div className="glass rounded-2xl p-4 lg:p-6 border border-white/10 bg-black/40">
          <div className="text-[9px] font-black text-gray-500 uppercase mb-3">输入</div>
          <label className="block mb-3">
            <span className="text-[10px] font-black text-gray-400 uppercase">OBJ（含 vt UV）</span>
            <input type="file" accept=".obj" onChange={onObjChange} className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:bg-blue-600/30 file:text-blue-300" />
          </label>
          <label className="block mb-3">
            <span className="text-[10px] font-black text-gray-400 uppercase">贴图（BaseColor 等）</span>
            <input type="file" accept="image/*" onChange={onTexChange} className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:bg-blue-600/30 file:text-blue-300" />
          </label>
          <label className="block mb-4">
            <span className="text-[10px] font-black text-gray-400 uppercase">Seam Mask（可选）</span>
            <input type="file" accept="image/*" onChange={onMaskChange} className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:bg-blue-600/30 file:text-blue-300" />
          </label>

          <div className="text-[9px] font-black text-gray-500 uppercase mb-2">参数</div>
          <div className="space-y-2 mb-4">
            <div>
              <span className="text-[9px] text-gray-500">贴图类型</span>
              <select value={params.texture_kind} onChange={(e) => setParams((p) => ({ ...p, texture_kind: e.target.value }))} className="w-full mt-0.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-blue-500">
                <option value="basecolor">BaseColor（sRGB）</option>
                <option value="data">数据贴图（线性）</option>
                <option value="normal">Normal（向量法线）</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[9px] text-gray-500">带宽(px)</span>
                <input type="number" min={1} max={64} value={params.band_px} onChange={(e) => setParams((p) => ({ ...p, band_px: Number(e.target.value) || 8 }))} className="w-full mt-0.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-blue-500" />
              </div>
              <div>
                <span className="text-[9px] text-gray-500">过渡(px)</span>
                <input type="number" min={0} max={64} value={params.feather_px} onChange={(e) => setParams((p) => ({ ...p, feather_px: Number(e.target.value) ?? 6 }))} className="w-full mt-0.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-blue-500" />
              </div>
            </div>
            <div>
              <span className="text-[9px] text-gray-500">沿边步长(px)</span>
              <input type="number" min={0.5} max={16} step={0.5} value={params.sample_step_px} onChange={(e) => setParams((p) => ({ ...p, sample_step_px: Number(e.target.value) || 2 }))} className="w-full mt-0.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-blue-500" />
            </div>
            <div>
              <span className="text-[9px] text-gray-500">模式</span>
              <select value={params.mode} onChange={(e) => setParams((p) => ({ ...p, mode: e.target.value }))} className="w-full mt-0.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-blue-500">
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
              <select value={params.alpha_method} onChange={(e) => setParams((p) => ({ ...p, alpha_method: e.target.value }))} className="w-full mt-0.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-blue-500">
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
              <select value={params.color_match} onChange={(e) => setParams((p) => ({ ...p, color_match: e.target.value }))} className="w-full mt-0.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-blue-500">
                <option value="meanvar">均值/方差（推荐）</option>
                <option value="meanvar_edge">按边（可能出色块）</option>
                <option value="none">关闭</option>
              </select>
            </div>
            <div>
              <span className="text-[9px] text-gray-500">Poisson 迭代</span>
              <input type="number" min={0} max={600} step={25} value={params.poisson_iters} onChange={(e) => setParams((p) => ({ ...p, poisson_iters: Number(e.target.value) || 0 }))} className="w-full mt-0.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-blue-500" />
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
            <select value={previewRotate} onChange={(e) => setPreviewRotate(Number(e.target.value))} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] outline-none focus:border-blue-500">
              <option value={0}>0°</option>
              <option value={90}>90°</option>
              <option value={180}>180°</option>
              <option value={270}>270°</option>
            </select>
          </div>

          <button onClick={handleRepair} disabled={repairing || !objFile || !texFile} className="w-full py-2.5 bg-blue-600 rounded-xl text-[10px] font-black uppercase electric-glow disabled:opacity-40">
            {repairing ? '修复中…' : '开始修复'}
          </button>
          {resultUrl && (
            <a href={resultUrl} download="repaired.png" className="mt-3 w-full py-2 border border-blue-500/50 rounded-xl text-[10px] font-black uppercase text-blue-300 text-center inline-block hover:bg-blue-600/20">
              下载修复图
            </a>
          )}
          <div className="mt-3 text-[9px] text-gray-500 min-h-[2rem]">{status}</div>
        </div>
      </div>

      {/* 右侧：上 2D 对比，下 3D 预览（两列布局，右侧单列上下排） */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-hidden">
        <div className="glass rounded-2xl p-4 border border-white/10 bg-black/40 shrink-0">
          <div className="text-[9px] font-black text-gray-500 uppercase mb-2">2D 对比</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] text-gray-500 mb-1">原图</div>
              <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden h-[140px] flex items-center justify-center">
                {texPreviewUrl ? <img src={texPreviewUrl} alt="原图" className="max-w-full max-h-full object-contain" /> : <span className="text-[9px] text-gray-600">—</span>}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-gray-500 mb-1">修复后</div>
              <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden h-[140px] flex items-center justify-center">
                {resultUrl ? <img src={resultUrl} alt="修复后" className="max-w-full max-h-full object-contain" /> : <span className="text-[9px] text-gray-600">—</span>}
              </div>
            </div>
          </div>
        </div>
        <div className="glass rounded-2xl p-4 border border-white/10 bg-black/40 flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-black text-gray-500 uppercase">3D 预览（OBJ）</span>
            {resultUrl && texPreviewUrl && (
              <button type="button" onClick={() => setUseResultTex((u) => !u)} className="text-[9px] font-black uppercase text-blue-400 hover:text-blue-300 border border-blue-500/40 rounded-lg px-2 py-1">
                {useResultTex ? '切到原图' : '切到修复后'}
              </button>
            )}
          </div>
          <div className="flex-1 rounded-xl border border-white/10 overflow-hidden min-h-[240px] bg-[#0a0a12]">
            <ObjTextureViewer objText={objText} textureUrl={currentTexUrl} flipX={previewFlipX} flipY={previewFlipY} rotateDeg={previewRotate} className="w-full h-full" />
          </div>
          <div className="text-[9px] text-gray-500 mt-1">鼠标左键旋转、滚轮缩放</div>
        </div>
        <footer className="text-[9px] text-gray-500 shrink-0">
          若接缝是<strong className="text-gray-400">法线/切线空间</strong>导致的「光照裂」，修 BaseColor 不会治本；本工具主要解决贴图跨缝不一致。
        </footer>
      </div>
      </div>
    </div>
  );
};

export default SeamRepairSection;
