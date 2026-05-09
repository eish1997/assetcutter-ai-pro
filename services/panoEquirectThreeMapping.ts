import * as THREE from 'three';

/**
 * 与 `THREE.SphereGeometry` 默认参数（phiStart=0, phiLength=2π, thetaStart=0, thetaLength=π）
 * 及 `uvs.push(u+uOffset, 1-v)` 一致的方向 ↔ 等距柱归一化 UV（**v=1 北极 / 纹理顶行，v=0 南极**）。
 * 此前用 `atan2(x,z)` + `0.5-lat/π` 与 Three 球面采样不一致，会导致全景局部重绘贴回错位。
 */
export function wrap01PanoU(u: number): number {
  let x = u % 1;
  if (x < 0) x += 1;
  return x;
}

/** 单位方向（原点 → 球面点，朝外）→ 与 Three 球面 UV 一致的 (u,v) */
export function directionToThreeSphereEquirectUv(dir: THREE.Vector3): { u: number; v: number } {
  const d = dir.clone().normalize();
  const theta = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1));
  const sinT = Math.sin(theta);
  let phi: number;
  if (sinT < 1e-6) {
    phi = 0;
  } else {
    phi = Math.atan2(d.z, -d.x);
  }
  const u = wrap01PanoU(phi / (2 * Math.PI));
  const v = THREE.MathUtils.clamp(1 - theta / Math.PI, 0, 1);
  return { u, v };
}

/** 与 Three 球面 UV 一致 → 单位方向（原点朝外） */
export function threeSphereEquirectUvToDirection(uu: number, vv: number): THREE.Vector3 {
  const u = wrap01PanoU(uu);
  const v = THREE.MathUtils.clamp(vv, 0, 1);
  const phi = u * 2 * Math.PI;
  const theta = (1 - v) * Math.PI;
  const sinT = Math.sin(theta);
  return new THREE.Vector3(-Math.cos(phi) * sinT, Math.cos(theta), Math.sin(phi) * sinT).normalize();
}

/**
 * `EquirectangularPanoramaCanvas` 对球体做了 `geometry.scale(-1, 1, 1)`（法线朝内），
 * UV 未随 X 镜像：世界方向 **+X** 上的像素实际采样的是「未翻转球」**-X** 侧的纹理（等距柱接缝）。
 * 以下两函数把「世界空间球心→表面」与「未翻转球 UV 约定」对齐。
 */
export function worldDirOnFlippedPanoSphereToEquirectUv(dir: THREE.Vector3): { u: number; v: number } {
  const d = dir.clone().normalize();
  return directionToThreeSphereEquirectUv(new THREE.Vector3(-d.x, d.y, d.z));
}

export function equirectUvToWorldPosOnFlippedPanoSphere(uu: number, vv: number, radius = 500): THREE.Vector3 {
  const d0 = threeSphereEquirectUvToDirection(uu, vv);
  return new THREE.Vector3(-d0.x * radius, d0.y * radius, d0.z * radius);
}
