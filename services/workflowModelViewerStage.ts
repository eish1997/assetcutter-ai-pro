import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export type WorkflowModelViewerStage = {
  pmremGenerator: THREE.PMREMGenerator;
  envRenderTarget: THREE.WebGLRenderTarget;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  keyLight: THREE.DirectionalLight;
  fillLight: THREE.DirectionalLight;
  rimLight: THREE.DirectionalLight;
  /** 模拟地面反弹：从模型下方向上打，避免底部/朝下面完全死黑 */
  bounceFill: THREE.DirectionalLight;
  dispose: () => void;
};

export function configureWorkflowModelSoftShadows(renderer: THREE.WebGLRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = true;
}

/** 默认 HDR：Poly Haven CC0「studio_small_09」1k（仓库内 `public/hdr/`），用于金属 IBL 反射 */
export function getDefaultWorkflowViewerHdrUrl(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${normalized}hdr/studio_small_09_1k.hdr`;
}

async function buildPmremEnvironment(
  renderer: THREE.WebGLRenderer,
  pmremGenerator: THREE.PMREMGenerator,
  hdrUrl: string | undefined,
  signal: AbortSignal | undefined
): Promise<THREE.WebGLRenderTarget> {
  const tryHdr = Boolean(hdrUrl?.trim());
  if (tryHdr && !signal?.aborted) {
    try {
      const loader = new HDRLoader();
      const tex = await loader.loadAsync(hdrUrl!);
      if (signal?.aborted) {
        tex.dispose();
        throw new DOMException('aborted', 'AbortError');
      }
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const rt = pmremGenerator.fromEquirectangular(tex);
      tex.dispose();
      return rt;
    } catch {
      /* 网络/404 时回退 Room */
    }
  }
  const roomEnv = new RoomEnvironment();
  const rt = pmremGenerator.fromScene(roomEnv, 0.04, 8, 220, { size: 384 });
  roomEnv.dispose();
  return rt;
}

function attachWorkflowModelViewerLights(scene: THREE.Scene): {
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  keyLight: THREE.DirectionalLight;
  fillLight: THREE.DirectionalLight;
  rimLight: THREE.DirectionalLight;
  bounceFill: THREE.DirectionalLight;
} {
  const hemi = new THREE.HemisphereLight(0xdde7f5, 0x8a7f74, 0.82);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xf2f4f8, 0.14);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xfff7ef, 0.82);
  keyLight.position.set(4.8, 12, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.000025;
  keyLight.shadow.normalBias = 0.03;
  keyLight.shadow.radius = 12;
  keyLight.shadow.blurSamples = 18;
  scene.add(keyLight);
  scene.add(keyLight.target);

  const fillLight = new THREE.DirectionalLight(0xc9d8f0, 0.72);
  fillLight.position.set(-7, 4.5, -4.5);
  scene.add(fillLight);
  scene.add(fillLight.target);

  const rimLight = new THREE.DirectionalLight(0xd5e9ff, 0.48);
  rimLight.position.set(1.5, 3.5, -8);
  scene.add(rimLight);
  scene.add(rimLight.target);

  const bounceFill = new THREE.DirectionalLight(0xfff3e8, 0.58);
  bounceFill.castShadow = false;
  bounceFill.position.set(0, -10, 2);
  scene.add(bounceFill);
  scene.add(bounceFill.target);

  return { hemi, ambient, keyLight, fillLight, rimLight, bounceFill };
}

/**
 * 异步创建展示舞台：**HDR equirect → PMREM**（失败则 Room）+ 半球/环境光 + 主补轮廓 + 底侧反弹。
 */
export async function createWorkflowModelViewerStageAsync(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  /** 传 `null` 时保留透明底（配合 `WebGLRenderer` `alpha: true` + 外层毛玻璃） */
  backgroundHex: number | null = 0x101218,
  options?: { hdrUrl?: string; signal?: AbortSignal }
): Promise<WorkflowModelViewerStage> {
  scene.background = backgroundHex === null ? null : new THREE.Color(backgroundHex);

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const hdrUrl = options?.hdrUrl?.trim() ? options.hdrUrl : getDefaultWorkflowViewerHdrUrl();
  const envRT = await buildPmremEnvironment(renderer, pmremGenerator, hdrUrl, options?.signal);
  if (options?.signal?.aborted) {
    envRT.dispose();
    pmremGenerator.dispose();
    throw new DOMException('aborted', 'AbortError');
  }
  scene.environment = envRT.texture;

  const lights = attachWorkflowModelViewerLights(scene);
  const { hemi, ambient, keyLight, fillLight, rimLight, bounceFill } = lights;

  const dispose = () => {
    scene.remove(hemi);
    scene.remove(ambient);
    scene.remove(keyLight);
    scene.remove(keyLight.target);
    scene.remove(fillLight);
    scene.remove(fillLight.target);
    scene.remove(rimLight);
    scene.remove(rimLight.target);
    scene.remove(bounceFill);
    scene.remove(bounceFill.target);
    scene.environment = null;
    envRT.dispose();
    pmremGenerator.dispose();
  };

  return {
    pmremGenerator,
    envRenderTarget: envRT,
    hemi,
    ambient,
    keyLight,
    fillLight,
    rimLight,
    bounceFill,
    dispose,
  };
}

/** 将平行光（含底侧反弹）目标与主光阴影相机对准包围盒（在 `frameCameraToObject` 之后调用） */
export function aimWorkflowModelLightsAtBox(
  keyLight: THREE.DirectionalLight,
  fillLight: THREE.DirectionalLight,
  rimLight: THREE.DirectionalLight,
  bounceFill: THREE.DirectionalLight,
  box: THREE.Box3
): void {
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const e = Math.max(s.x, s.y, s.z, 0.08);

  keyLight.target.position.copy(c);
  fillLight.target.position.copy(c);
  rimLight.target.position.copy(c);
  bounceFill.target.position.set(c.x, c.y + e * 0.25, c.z);

  keyLight.position.set(c.x + e * 2.0, c.y + e * 2.9, c.z + e * 2.2);
  fillLight.position.set(c.x - e * 2.5, c.y + e * 1.05, c.z - e * 1.7);
  rimLight.position.set(c.x + e * 0.25, c.y + e * 1.85, c.z - e * 2.85);
  bounceFill.position.set(c.x + e * 0.55, box.min.y - e * 2.35, c.z + e * 1.15);

  keyLight.updateMatrixWorld();
  fillLight.updateMatrixWorld();
  rimLight.updateMatrixWorld();
  bounceFill.updateMatrixWorld();
  keyLight.target.updateMatrixWorld();
  bounceFill.target.updateMatrixWorld();

  const cam = keyLight.shadow.camera as THREE.OrthographicCamera;
  keyLight.shadow.updateMatrices(keyLight);
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ].map((v) => v.applyMatrix4(cam.matrixWorldInverse));
  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  for (const corner of corners) {
    min.min(corner);
    max.max(corner);
  }
  const shadowWidth = Math.max(max.x - min.x, e * 0.42, 0.1);
  const shadowHeight = Math.max(max.y - min.y, e * 0.42, 0.1);
  const pad = Math.max(shadowWidth, shadowHeight, e * 0.22, 0.05) * 0.34;
  const depthPad = Math.max(e * 1.8, 0.25);
  cam.left = min.x - pad;
  cam.right = max.x + pad;
  cam.bottom = min.y - pad;
  cam.top = max.y + pad;
  cam.near = Math.max(0.01, -max.z - depthPad);
  cam.far = Math.max(cam.near + 0.1, -min.z + depthPad);
  cam.updateProjectionMatrix();
  const biasScale = Math.max(e, 0.08);
  keyLight.shadow.bias = -Math.min(0.00005, 0.000016 * biasScale);
  keyLight.shadow.normalBias = Math.min(0.07, Math.max(0.018, biasScale * 0.012));
  keyLight.shadow.radius = 12;
  keyLight.shadow.blurSamples = 18;
  keyLight.shadow.needsUpdate = true;
}

/**
 * 扁平板状浮雕（高度场 MatCap）：在 `aimWorkflowModelLightsAtBox` 基础上微调灯位，
 * 主光略抬高偏前、补光略靠前，便于顶面起伏与接触影可读。
 */
export function aimHeightfieldReliefLightsAtBox(
  keyLight: THREE.DirectionalLight,
  fillLight: THREE.DirectionalLight,
  rimLight: THREE.DirectionalLight,
  bounceFill: THREE.DirectionalLight,
  box: THREE.Box3
): void {
  aimWorkflowModelLightsAtBox(keyLight, fillLight, rimLight, bounceFill, box);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const e = Math.max(s.x, s.y, s.z, 0.08);

  keyLight.position.set(c.x + e * 1.62, c.y + e * 3.45, c.z + e * 1.82);
  fillLight.position.set(c.x - e * 2.08, c.y + e * 1.48, c.z - e * 1.22);
  rimLight.position.set(c.x + e * 0.32, c.y + e * 2.05, c.z - e * 2.72);
  bounceFill.position.set(c.x + e * 0.45, box.min.y - e * 2.05, c.z + e * 1.18);

  keyLight.updateMatrixWorld();
  fillLight.updateMatrixWorld();
  rimLight.updateMatrixWorld();
  bounceFill.updateMatrixWorld();
}

/**
 * MatCap 浮雕场景：略抬半球/环境/平行光整体亮度，主光略暖、阴影略柔，减轻「整体发闷」
 *（主体仍由 MatCap；灯光主要服务地面接触影与视口氛围）。
 */
export function applyHeightfieldMatcapSceneLighting(stage: WorkflowModelViewerStage): void {
  stage.hemi.intensity *= 1.22;
  stage.hemi.color.setHex(0xdce8f6);
  stage.hemi.groundColor.setHex(0x454550);

  stage.ambient.intensity *= 1.55;
  stage.ambient.color.setHex(0xeff2f8);

  stage.keyLight.intensity *= 1.28;
  stage.keyLight.color.setHex(0xfff7f2);

  stage.fillLight.intensity *= 1.14;
  stage.fillLight.color.setHex(0xc4d4ec);

  stage.rimLight.intensity *= 1.16;
  stage.rimLight.color.setHex(0xd8e8ff);

  stage.bounceFill.intensity *= 1.12;
  stage.bounceFill.color.setHex(0xfff4eb);

  stage.keyLight.shadow.radius = 9;
  stage.keyLight.shadow.blurSamples = 14;
}

export function enhanceLoadedModelMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mesh = obj;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
        const cur = m.envMapIntensity ?? 1;
        const metal = m.metalness ?? 0;
        // HDR IBL 下略抬下限，金属反射里能读到环境细节
        const floor = metal > 0.65 ? 1.55 : metal > 0.25 ? 1.22 : 1.08;
        m.envMapIntensity = Math.max(cur, floor);
        if (m.metalness !== undefined && m.metalness < 0.02 && m.roughness !== undefined && m.roughness > 0.96) {
          m.roughness = 0.82;
        }
      }
    }
  });
}

/**
 * 大平面 + `ShadowMaterial`：只「接住」阴影，不画实体底色，避免与纯黑背景形成明显矩形台面。
 */
export function createStudioGroundMesh(box: THREE.Box3, margin = 10): THREE.Mesh | null {
  if (box.isEmpty()) return null;
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const half = Math.max(s.x, s.z, 0.5) * margin;
  const geo = new THREE.PlaneGeometry(half * 2, half * 2, 1, 1);
  const mat = new THREE.ShadowMaterial({
    color: 0x000000,
    opacity: 0.22,
    transparent: true,
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(c.x, box.min.y - 0.012, c.z);
  ground.receiveShadow = true;
  return ground;
}
