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
  return fromPath(url);
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
  options?: { defaultView?: WorkflowModelDefaultView }
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const safeDist = distance * 1.6;
  const lift = center.y + maxDim * 0.2;
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
  camera.near = Math.max(0.01, safeDist / 200);
  camera.far = Math.max(100, safeDist * 10);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
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
