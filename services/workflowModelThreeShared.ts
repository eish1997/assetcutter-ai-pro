import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ModelFormat = 'gltf' | 'fbx' | 'obj' | 'unknown';

export function inferModelFormat(url: string, fileName?: string): ModelFormat {
  const fromPath = (p: string): ModelFormat => {
    const pure = p.split('#')[0]?.split('?')[0] ?? p;
    const base = pure.split(/[/\\]/).pop() ?? pure;
    if (/\.glb$/i.test(base)) return 'gltf';
    if (/\.gltf$/i.test(base)) return 'gltf';
    if (/\.fbx$/i.test(base)) return 'fbx';
    if (/\.obj$/i.test(base)) return 'obj';
    return 'unknown';
  };
  const a = fromPath(fileName || '');
  if (a !== 'unknown') return a;
  const fn = String(fileName || '');
  if (/_fbx(\.|$|_)/i.test(fn)) return 'fbx';
  if (/_glb(\.|$|_)/i.test(fn)) return 'gltf';
  const fromUrl = fromPath(url);
  if (fromUrl !== 'unknown') return fromUrl;
  /** `blob:` 与部分伴侣回读 URL 不含扩展名；工作流 Tripo/混元首槽几乎恒为 GLB */
  const u = String(url || '').trim();
  if (/^blob:/i.test(u)) return 'gltf';
  return 'unknown';
}

/**
 * PBR 槽位 TextureLoader 贴图的 flipY。
 * - glTF/GLB：false（与 GLTFLoader 一致）
 * - FBX/OBJ：true（TextureLoader / OpenGL 默认；手动导入贴图常用此约定）
 * - unknown：用户稿 true，embedded false
 */
export function resolveWorkflowPbrTextureFlipY(
  modelFormat: ModelFormat,
  edit?: { source?: 'embedded' | 'user' } | null
): boolean {
  if (modelFormat === 'gltf') return false;
  if (modelFormat === 'fbx' || modelFormat === 'obj') return true;
  if (edit?.source === 'embedded') return false;
  return true;
}

/**
 * 默认观察方位（世界坐标系，Y 向上）：
 * - `+x`：相机在物体 **+X** 一侧，朝原点看 → 物体 **-X 面**朝向镜头，常见资产里常对应「把右侧当正面」的观感。
 * - `+z`：相机在 **+Z** 侧（旧默认）。
 */
export type WorkflowModelDefaultView = '+x' | '-x' | '+z' | '-z';

export function frameCameraToObject(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  object: THREE.Object3D,
  options?: {
    defaultView?: WorkflowModelDefaultView;
    preserveViewDirection?: boolean;
    viewDirection?: THREE.Vector3;
    fitPadding?: number;
  }
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, maxDim * 0.5, 0.001);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.001));
  const fitVertical = radius / Math.sin(verticalFov / 2);
  const fitHorizontal = radius / Math.sin(horizontalFov / 2);
  const safeDist = Math.max(fitVertical, fitHorizontal) * (options?.fitPadding ?? 1.12);
  const lift = center.y + maxDim * 0.2;
  const previousDirection = camera.position.clone().sub(controls.target);
  const customDirection = options?.viewDirection?.clone();
  if (customDirection && customDirection.lengthSq() > 1e-8) {
    camera.position.copy(center).add(customDirection.normalize().multiplyScalar(safeDist));
  } else if (options?.preserveViewDirection && previousDirection.lengthSq() > 1e-8) {
    camera.position.copy(center).add(previousDirection.normalize().multiplyScalar(safeDist));
  } else {
    const view = options?.defaultView ?? '+x';
    switch (view) {
      case '-x':
        camera.position.set(center.x - safeDist, lift, center.z);
        break;
      case '-z':
        camera.position.set(center.x, lift, center.z - safeDist);
        break;
      case '+z':
        camera.position.set(center.x, lift, center.z + safeDist);
        break;
      case '+x':
      default:
        camera.position.set(center.x + safeDist, lift, center.z);
        break;
    }
  }
  camera.near = Math.max(0.001, radius / 1000);
  camera.far = Math.max(100000, safeDist + radius * 10000);
  camera.updateProjectionMatrix();
  controls.minDistance = Math.max(0.001, radius * 0.015);
  controls.maxDistance = Math.max(100000, safeDist + radius * 10000);
  controls.target.copy(center);
  controls.update();
}

function isFiniteVec3(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  );
}

/** 校验/归一化持久化的 3D 视口状态；非法则返回 null */
export function normalizeWorkflowModel3dViewState(raw: unknown): {
  camera: { position: [number, number, number]; target: [number, number, number] };
  displayMode?: 'material' | 'clay' | 'wire' | 'normal';
  showGrid?: boolean;
  backfaceCulling?: boolean;
  updatedAt: number;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const cam = rec.camera;
  if (!cam || typeof cam !== 'object') return null;
  const camRec = cam as Record<string, unknown>;
  if (!isFiniteVec3(camRec.position) || !isFiniteVec3(camRec.target)) return null;
  const mode = rec.displayMode;
  const displayMode =
    mode === 'material' || mode === 'clay' || mode === 'wire' || mode === 'normal' ? mode : undefined;
  return {
    camera: {
      position: [camRec.position[0], camRec.position[1], camRec.position[2]],
      target: [camRec.target[0], camRec.target[1], camRec.target[2]],
    },
    ...(displayMode ? { displayMode } : {}),
    ...(typeof rec.showGrid === 'boolean' ? { showGrid: rec.showGrid } : {}),
    ...(typeof rec.backfaceCulling === 'boolean' ? { backfaceCulling: rec.backfaceCulling } : {}),
    updatedAt: Number.isFinite(rec.updatedAt) ? Number(rec.updatedAt) : Date.now(),
  };
}

/** 在已 frame 好 near/far/min/max 后覆盖相机位姿 */
export function applyWorkflowModel3dCameraPose(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  pose: { position: [number, number, number]; target: [number, number, number] }
): void {
  camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
  controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
  controls.update();
}

/**
 * 判断持久化相机是否仍能看到模型。坏姿态（钻进模型、飞到天外、target 偏离）会导致「打开后一片毛玻璃」。
 */
export function isWorkflowModel3dCameraPoseSane(
  pose: { position: [number, number, number]; target: [number, number, number] },
  box: THREE.Box3
): boolean {
  if (box.isEmpty()) return false;
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1e-4);
  const pos = new THREE.Vector3(pose.position[0], pose.position[1], pose.position[2]);
  const target = new THREE.Vector3(pose.target[0], pose.target[1], pose.target[2]);
  if (![pos.x, pos.y, pos.z, target.x, target.y, target.z].every(Number.isFinite)) return false;
  const dist = pos.distanceTo(target);
  if (!(dist > radius * 0.05 && dist < radius * 80)) return false;
  if (target.distanceTo(center) > radius * 4) return false;
  return true;
}

export function disposeObjectHierarchy(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
