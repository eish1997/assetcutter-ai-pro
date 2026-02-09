// 说明：
// - 使用 ESM（module）方式加载 three.js。
// - backend 会把 three.module.min.js +（已 patch 的）OrbitControls/OBJLoader 缓存到 /static/vendor/three/
//   这样浏览器不需要 import map，也不需要直连外网 CDN。
// - 若本地 vendor 不存在，则回退到 CDN（仍可能被拦截）。
const SOURCES = [
  {
    name: "local",
    three: "/static/vendor/three/three.module.min.js",
    orbit: "/static/vendor/three/OrbitControls.js",
    obj: "/static/vendor/three/OBJLoader.js",
  },
  {
    name: "unpkg",
    three: "https://unpkg.com/three@0.161.0/build/three.module.min.js",
    orbit: "https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js",
    obj: "https://unpkg.com/three@0.161.0/examples/jsm/loaders/OBJLoader.js",
  },
  {
    name: "jsdelivr",
    three: "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.min.js",
    orbit: "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/OrbitControls.js",
    obj: "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/loaders/OBJLoader.js",
  },
];

const $ = (id) => document.getElementById(id);

const el = {
  objFile: $("objFile"),
  texFile: $("texFile"),
  maskFile: $("maskFile"),
  textureKind: $("textureKind"),
  bandPx: $("bandPx"),
  featherPx: $("featherPx"),
  stepPx: $("stepPx"),
  mode: $("mode"),
  onlyMasked: $("onlyMasked"),
  alphaMethod: $("alphaMethod"),
  alphaEdgeAware: $("alphaEdgeAware"),
  colorMatch: $("colorMatch"),
  poissonIters: $("poissonIters"),
  previewFlipX: $("previewFlipX"),
  previewFlipY: $("previewFlipY"),
  previewRotate: $("previewRotate"),
  btnRepair: $("btnRepair"),
  btnToggleTex: $("btnToggleTex"),
  downloadLink: $("downloadLink"),
  status: $("status"),
  imgBefore: $("imgBefore"),
  imgAfter: $("imgAfter"),
  canvas: $("view3d"),
};

let objText = null;
let beforeTexUrl = null;
let afterTexUrl = null;
let usingAfter = false;

function setStatus(msg) {
  el.status.textContent = msg;
}

function revokeUrl(u) {
  if (u) URL.revokeObjectURL(u);
}

// ---------- three.js viewer ----------

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let currentRoot = null;
let currentMaterial = null;
let threeReady = false;
let three = null; // {THREE, OrbitControls, OBJLoader}
let debugRoot = null;
let debugCube = null;

async function loadThreeWithFallback() {
  for (const s of SOURCES) {
    try {
      const [THREE, orbitMod, objMod] = await Promise.all([
        import(s.three),
        import(s.orbit),
        import(s.obj),
      ]);
      return { THREE, OrbitControls: orbitMod.OrbitControls, OBJLoader: objMod.OBJLoader };
    } catch (e) {
      console.warn(`three 加载失败（${s.name}）`, e);
      continue;
    }
  }
  return null;
}

function resize() {
  if (!threeReady) return;
  const rect = el.canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
// resize() 会在 three 初始化成功后调用

function frame() {
  if (threeReady) {
    if (debugCube) {
      debugCube.rotation.y += 0.01;
      debugCube.rotation.x += 0.005;
    }
    controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

async function textureFromUrl(url) {
  if (!threeReady) throw new Error("three.js 未初始化");
  // Use ImageBitmap for performance on big textures.
  const res = await fetch(url);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const tex = new three.THREE.Texture(bitmap);
  tex.colorSpace = three.THREE.SRGBColorSpace;
  // 贴图坐标系按默认约定处理（固定翻转）
  tex.flipY = true;
  applyPreviewTexTransform(tex);
  tex.needsUpdate = true;
  return tex;
}

function applyPreviewTexTransform(tex) {
  if (!threeReady || !tex) return;
  // 通过 repeat/offset/rotation 做“仅预览”的贴图校正
  tex.wrapS = three.THREE.RepeatWrapping;
  tex.wrapT = three.THREE.RepeatWrapping;

  const flipX = !!el.previewFlipX?.checked;
  const flipY = !!el.previewFlipY?.checked;
  const rotDeg = parseInt(el.previewRotate?.value || "0", 10) || 0;

  tex.center.set(0.5, 0.5);
  tex.rotation = (rotDeg * Math.PI) / 180.0;
  tex.repeat.set(flipX ? -1 : 1, flipY ? -1 : 1);
  tex.offset.set(flipX ? 1 : 0, flipY ? 1 : 0);
  tex.needsUpdate = true;
}

function applyPreviewTransformToCurrentMap() {
  if (!threeReady || !currentMaterial?.map) return;
  applyPreviewTexTransform(currentMaterial.map);
  currentMaterial.needsUpdate = true;
}

function setModelMaterialMap(tex) {
  if (!threeReady || !currentRoot) return;
  if (!currentMaterial) {
    currentMaterial = new three.THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
  }
  // 释放旧贴图，避免反复切换导致内存涨
  if (currentMaterial.map && currentMaterial.map !== tex) {
    try {
      currentMaterial.map.dispose?.();
    } catch {}
  }
  currentMaterial.map = tex;
  currentMaterial.needsUpdate = true;

  currentRoot.traverse((o) => {
    if (o.isMesh) {
      o.material = currentMaterial;
      o.material.needsUpdate = true;
    }
  });
}

function centerAndFrame(root) {
  const box = new three.THREE.Box3().setFromObject(root);
  const size = new three.THREE.Vector3();
  const center = new three.THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  root.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim * 1.6 + 0.6;
  camera.position.set(dist, dist * 0.7, dist);
  camera.near = Math.max(0.001, dist / 2000);
  camera.far = dist * 50;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}

async function loadObj(text) {
  if (!threeReady) throw new Error("three.js 未初始化");
  const loader = new three.OBJLoader();
  const root = loader.parse(text);
  root.traverse((o) => {
    if (o.isMesh) {
      o.geometry.computeVertexNormals();
    }
  });
  return root;
}

async function refresh3D() {
  if (!threeReady || !objText) return;
  setStatus("加载 3D 预览中…");
  try {
    if (currentRoot) scene.remove(currentRoot);
    currentRoot = await loadObj(objText);
    scene.add(currentRoot);
    centerAndFrame(currentRoot);

    if (beforeTexUrl) {
      const tex = await textureFromUrl(beforeTexUrl);
      setModelMaterialMap(tex);
    }
    setStatus("3D 预览已加载。");
  } catch (e) {
    console.error(e);
    setStatus(`3D 预览加载失败：${e?.message || e}`);
  }
}

async function initThreeIfPossible() {
  try {
    if (!window.WebGLRenderingContext) {
      throw new Error("当前浏览器/环境不支持 WebGL（3D 预览不可用）");
    }
    // WebGL sanity check (some environments expose WebGLRenderingContext but still fail to create context)
    const gl =
      el.canvas.getContext("webgl2", { antialias: true })
      || el.canvas.getContext("webgl", { antialias: true })
      || el.canvas.getContext("experimental-webgl", { antialias: true });
    if (!gl) {
      throw new Error("WebGL 上下文创建失败（可能显卡驱动/远程桌面/浏览器策略禁用）");
    }
    const loaded = await loadThreeWithFallback();
    if (!loaded) throw new Error("three.js 相关模块加载失败（本地 vendor 或 CDN 都不可用）");
    three = loaded;

    renderer = new three.THREE.WebGLRenderer({ canvas: el.canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = three.THREE.SRGBColorSpace;
    renderer.setClearAlpha(0);

    scene = new three.THREE.Scene();
    scene.background = null;

    camera = new three.THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.position.set(1.6, 1.2, 1.6);

    controls = new three.OrbitControls(camera, el.canvas);
    controls.enableDamping = true;

    scene.add(new three.THREE.AmbientLight(0xffffff, 0.55));
    const dir = new three.THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(2.5, 3.5, 2.0);
    scene.add(dir);

    const grid = new three.THREE.GridHelper(4, 8, 0x3a4a62, 0x1b2635);
    grid.material.opacity = 0.25;
    grid.material.transparent = true;
    scene.add(grid);

    // Always show a small debug gizmo so we can confirm the renderer works
    debugRoot = new three.THREE.Group();
    debugRoot.add(new three.THREE.AxesHelper(0.8));
    debugCube = new three.THREE.Mesh(
      new three.THREE.BoxGeometry(0.35, 0.35, 0.35),
      new three.THREE.MeshStandardMaterial({ color: 0x66a3ff, roughness: 0.35, metalness: 0.0 })
    );
    debugCube.position.set(0, 0.2, 0);
    debugRoot.add(debugCube);
    scene.add(debugRoot);

    threeReady = true;
    // Layout may not be stable at module init; schedule a few resizes.
    resize();
    requestAnimationFrame(() => resize());
    setTimeout(() => resize(), 60);
    if (objText) await refresh3D();
    const rect = el.canvas.getBoundingClientRect();
    setStatus(`就绪（3D 预览可用）：轴/方块/网格应可见（canvas ${Math.round(rect.width)}x${Math.round(rect.height)}）。`);
  } catch (e) {
    console.warn("three.js 加载失败，3D 预览降级：", e);
    threeReady = false;
    el.btnToggleTex.disabled = true;
    setStatus(`就绪（3D 预览不可用，但修复功能可用）：${e?.message || e}`);
  }
}

// ---------- inputs ----------

el.objFile.addEventListener("change", async () => {
  const f = el.objFile.files?.[0];
  if (!f) return;
  objText = await f.text();
  if (threeReady) await refresh3D();
});

el.texFile.addEventListener("change", async () => {
  const f = el.texFile.files?.[0];
  if (!f) return;
  revokeUrl(beforeTexUrl);
  beforeTexUrl = URL.createObjectURL(f);
  el.imgBefore.src = beforeTexUrl;
  usingAfter = false;
  el.btnToggleTex.textContent = "3D 预览切换：原图";
  el.btnToggleTex.disabled = true;
  el.downloadLink.style.display = "none";
  revokeUrl(afterTexUrl);
  afterTexUrl = null;
  el.imgAfter.removeAttribute("src");
  if (objText) await refresh3D();
});

// 仅预览：贴图校正参数变化时立即更新 3D 显示
for (const ctrl of [el.previewFlipX, el.previewFlipY, el.previewRotate]) {
  ctrl?.addEventListener("change", () => {
    applyPreviewTransformToCurrentMap();
    setStatus("已更新 3D 预览贴图校正（仅预览）。");
  });
}

// ---------- repair ----------

function needFiles() {
  if (!el.objFile.files?.[0]) return "请先选择 OBJ 文件。";
  if (!el.texFile.files?.[0]) return "请先选择贴图文件。";
  return null;
}

async function doRepair() {
  const err = needFiles();
  if (err) {
    setStatus(err);
    return;
  }

  setStatus("上传并修复中…（4K 贴图可能需要几十秒）");
  el.btnRepair.disabled = true;

  const form = new FormData();
  form.append("obj", el.objFile.files[0]);
  form.append("texture", el.texFile.files[0]);
  if (el.maskFile.files?.[0]) form.append("seam_mask", el.maskFile.files[0]);
  form.append("texture_kind", el.textureKind?.value || "basecolor");
  form.append("band_px", String(parseInt(el.bandPx.value || "8", 10)));
  form.append("feather_px", String(parseInt(el.featherPx.value || "6", 10)));
  form.append("sample_step_px", String(parseFloat(el.stepPx.value || "2")));
  form.append("mode", el.mode.value);
  form.append("only_masked_seams", el.onlyMasked.checked ? "true" : "false");
  form.append("alpha_method", el.alphaMethod?.value || "distance");
  form.append("alpha_edge_aware", el.alphaEdgeAware?.checked ? "true" : "false");
  form.append("color_match", el.colorMatch?.value || "meanvar");
  form.append("poisson_iters", String(parseInt(el.poissonIters?.value || "0", 10)));

  try {
    const resp = await fetch("/api/repair", { method: "POST", body: form });
    if (!resp.ok) {
      const j = await resp.json().catch(() => null);
      throw new Error(j?.error || `HTTP ${resp.status}`);
    }

    const blob = await resp.blob();
    revokeUrl(afterTexUrl);
    afterTexUrl = URL.createObjectURL(blob);
    el.imgAfter.src = afterTexUrl;

    el.downloadLink.href = afterTexUrl;
    el.downloadLink.style.display = "inline-flex";

    el.btnToggleTex.disabled = false;
    usingAfter = true;
    el.btnToggleTex.textContent = "3D 预览切换：修复后";
    await applyCurrentTextureTo3D();
    setStatus("修复完成。你可以在 2D/3D 中对比，并下载修复图。");
  } catch (e) {
    console.error(e);
    setStatus(`修复失败：${e?.message || e}`);
  } finally {
    el.btnRepair.disabled = false;
  }
}

async function applyCurrentTextureTo3D() {
  if (!threeReady || !currentRoot) return;
  const url = usingAfter ? afterTexUrl : beforeTexUrl;
  if (!url) return;
  const tex = await textureFromUrl(url);
  setModelMaterialMap(tex);
}

el.btnRepair.addEventListener("click", doRepair);

el.btnToggleTex.addEventListener("click", async () => {
  if (!afterTexUrl || !beforeTexUrl) return;
  usingAfter = !usingAfter;
  el.btnToggleTex.textContent = usingAfter ? "3D 预览切换：修复后" : "3D 预览切换：原图";
  setStatus(usingAfter ? "3D 显示：修复后" : "3D 显示：原图");
  await applyCurrentTextureTo3D();
});

// boot
setStatus("初始化中…");
initThreeIfPossible();

