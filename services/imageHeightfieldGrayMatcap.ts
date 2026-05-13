import * as THREE from 'three';

const MATCAP_SIZE = 256;

/**
 * 程序化生成接近 ZBrush「灰 MatCap」的球面光照贴图：中灰体、左上高光、边缘略收、避免整体过曝。
 * 用于 `MeshMatcapMaterial.matcap`，着色仅依赖法线与视角，不跟场景 PBR 灯光混算。
 */
export function createZbrushStyleGrayMatcapTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = MATCAP_SIZE;
  canvas.height = MATCAP_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 MatCap Canvas 2D 上下文');
  const img = ctx.createImageData(MATCAP_SIZE, MATCAP_SIZE);
  const d = img.data;
  // 主光方向（切线/视空间与 Three MatCap 采样习惯一致：偏左上）
  const lx = 0.5;
  const ly = 0.42;
  const lz = 0.78;
  const invLen = 1 / Math.hypot(lx, ly, lz);
  const Lx = lx * invLen;
  const Ly = ly * invLen;
  const Lz = lz * invLen;

  for (let py = 0; py < MATCAP_SIZE; py++) {
    for (let px = 0; px < MATCAP_SIZE; px++) {
      const u = (px + 0.5) / MATCAP_SIZE;
      const v = (py + 0.5) / MATCAP_SIZE;
      const nx = (u - 0.5) * 2;
      const ny = (v - 0.5) * 2;
      const r2 = nx * nx + ny * ny;
      const i = (py * MATCAP_SIZE + px) * 4;
      if (r2 > 1) {
        d[i] = 0x34;
        d[i + 1] = 0x34;
        d[i + 2] = 0x3a;
        d[i + 3] = 255;
        continue;
      }
      const nz = Math.sqrt(Math.max(0, 1 - r2));
      let nd = nx * Lx + ny * Ly + nz * Lz;
      if (nd < 0) nd = 0;
      if (nd > 1) nd = 1;
      const ambient = 0.16;
      const diffuse = 0.68 * Math.pow(nd, 0.8);
      const wrap = 0.09 * Math.pow(nd, 0.32);
      const rim = 0.11 * Math.pow(nz, 2.25);
      let g = ambient + diffuse + wrap + rim;
      g = Math.pow(g * 0.8 + 0.1, 0.93);
      const cl = Math.min(255, Math.max(0, Math.round(g * 255)));
      d[i] = cl;
      d[i + 1] = cl;
      d[i + 2] = cl;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
