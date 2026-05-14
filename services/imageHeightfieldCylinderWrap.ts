import type { BufferAttribute, Mesh } from 'three';

/** 左右边沿周向卷成外壁圆柱：θ=2π 时左缘与右缘相接；置换沿外法线。 */
export function applyHeightfieldCylinderWrapPositions(mesh: Mesh, curl01: number, displaceMul: number): void {
  const planeW = mesh.userData.planeW as number | undefined;
  const flatX = mesh.userData.flatX as Float32Array | undefined;
  const flatY = mesh.userData.flatY as Float32Array | undefined;
  const zBase = mesh.userData.zBase as Float32Array | undefined;
  const geo = mesh.geometry;
  if (!planeW || !flatX || !flatY || !zBase || !geo?.attributes?.position) return;

  const pos = geo.attributes.position as BufferAttribute;
  const n = pos.count;
  if (flatX.length !== n || flatY.length !== n || zBase.length !== n) return;

  const theta = Math.max(0, Math.min(1, curl01)) * Math.PI * 2;
  const eps = 1e-5;

  for (let i = 0; i < n; i++) {
    const x = flatX[i]!;
    const y = flatY[i]!;
    const h = zBase[i]! * displaceMul;

    if (theta < eps) {
      pos.setXYZ(i, x, y, h);
      continue;
    }

    const R = planeW / theta;
    const phi = (x * theta) / planeW;
    const sinp = Math.sin(phi);
    const cosp = Math.cos(phi);
    const xb = R * sinp;
    const zb = R * (cosp - 1);
    const nx = sinp;
    const nz = cosp;
    pos.setXYZ(i, xb + nx * h, y, zb + nz * h);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const na = geo.attributes.normal as BufferAttribute | undefined;
  if (na) na.needsUpdate = true;
}
