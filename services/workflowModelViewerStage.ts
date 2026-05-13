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
  const hemi = new THREE.HemisphereLight(0xd2dff0, 0x6b5e52, 0.66);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xe8ecf2, 0.09);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xfff5eb, 1.05);
  keyLight.position.set(4.8, 12, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.00025;
  keyLight.shadow.normalBias = 0.038;
  keyLight.shadow.radius = 5;
  scene.add(keyLight);
  scene.add(keyLight.target);

  const fillLight = new THREE.DirectionalLight(0xb4c8ec, 0.52);
  fillLight.position.set(-7, 4.5, -4.5);
  scene.add(fillLight);
  scene.add(fillLight.target);

  const rimLight = new THREE.DirectionalLight(0xc8e4ff, 0.62);
  rimLight.position.set(1.5, 3.5, -8);
  scene.add(rimLight);
  scene.add(rimLight.target);

  const bounceFill = new THREE.DirectionalLight(0xffefe0, 0.46);
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
  cam.near = 0.05;
  cam.far = e * 26;
  const ext = e * 4.2;
  cam.left = -ext;
  cam.right = ext;
  cam.top = ext;
  cam.bottom = -ext;
  cam.updateProjectionMatrix();
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

  stage.keyLight.shadow.radius = 4.4;
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
    opacity: 0.3,
    transparent: true,
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(c.x, box.min.y - 0.012, c.z);
  ground.receiveShadow = true;
  return ground;
}
