import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type WorkflowModelViewerStage = {
  pmremGenerator: THREE.PMREMGenerator;
  envRenderTarget: THREE.WebGLRenderTarget;
  hemi: THREE.HemisphereLight;
  keyLight: THREE.DirectionalLight;
  fillLight: THREE.DirectionalLight;
  rimLight: THREE.DirectionalLight;
  dispose: () => void;
};

/**
 * 工作室级展示：Room PMREM（中性 IBL）+ 半球天光 + 主/补/轮廓三盏平行光。
 * 调用方负责 `renderer.shadowMap` 与加载后对 `aimWorkflowModelLightsAtObject` 的调用。
 */
export function createWorkflowModelViewerStage(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  /** 传 `null` 时保留透明底（配合 `WebGLRenderer` `alpha: true` + 外层毛玻璃） */
  backgroundHex: number | null = 0x101218
): WorkflowModelViewerStage {
  scene.background = backgroundHex === null ? null : new THREE.Color(backgroundHex);

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envRT = pmremGenerator.fromScene(roomEnv, 0.04, 8, 220, { size: 256 });
  scene.environment = envRT.texture;
  roomEnv.dispose();

  const hemi = new THREE.HemisphereLight(0xc8d8ea, 0x2a221c, 0.44);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xfff5eb, 1.28);
  keyLight.position.set(4.8, 12, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.00025;
  keyLight.shadow.normalBias = 0.038;
  keyLight.shadow.radius = 3.5;
  scene.add(keyLight);
  scene.add(keyLight.target);

  const fillLight = new THREE.DirectionalLight(0xa8c4f0, 0.4);
  fillLight.position.set(-7, 4.5, -4.5);
  scene.add(fillLight);
  scene.add(fillLight.target);

  const rimLight = new THREE.DirectionalLight(0xb8dcff, 0.55);
  rimLight.position.set(1.5, 3.5, -8);
  scene.add(rimLight);
  scene.add(rimLight.target);

  const dispose = () => {
    scene.remove(hemi);
    scene.remove(keyLight);
    scene.remove(keyLight.target);
    scene.remove(fillLight);
    scene.remove(fillLight.target);
    scene.remove(rimLight);
    scene.remove(rimLight.target);
    scene.environment = null;
    envRT.dispose();
    pmremGenerator.dispose();
  };

  return { pmremGenerator, envRenderTarget: envRT, hemi, keyLight, fillLight, rimLight, dispose };
}

/** 将三盏平行光目标与阴影相机对准包围盒（在 `frameCameraToObject` 之后调用） */
export function aimWorkflowModelLightsAtBox(
  keyLight: THREE.DirectionalLight,
  fillLight: THREE.DirectionalLight,
  rimLight: THREE.DirectionalLight,
  box: THREE.Box3
): void {
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const e = Math.max(s.x, s.y, s.z, 0.08);

  keyLight.target.position.copy(c);
  fillLight.target.position.copy(c);
  rimLight.target.position.copy(c);

  keyLight.position.set(c.x + e * 2.0, c.y + e * 2.9, c.z + e * 2.2);
  fillLight.position.set(c.x - e * 2.5, c.y + e * 1.05, c.z - e * 1.7);
  rimLight.position.set(c.x + e * 0.25, c.y + e * 1.85, c.z - e * 2.85);

  keyLight.updateMatrixWorld();
  fillLight.updateMatrixWorld();
  rimLight.updateMatrixWorld();
  keyLight.target.updateMatrixWorld();

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

export function enhanceLoadedModelMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mesh = obj;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
        const cur = m.envMapIntensity ?? 1;
        m.envMapIntensity = Math.max(cur, 1.05);
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
