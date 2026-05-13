import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** 仅释放克隆体几何；材质/贴图可能与场景网格共享引用，不可 dispose。 */
function disposeExportCloneGeometry(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry?.dispose();
  });
}

/**
 * 将当前网格导出为二进制 GLB 并触发浏览器下载（克隆后导出，不改动场景内原网格）。
 */
export async function downloadMeshAsGlb(mesh: THREE.Mesh, filename: string): Promise<void> {
  const clone = mesh.clone(true) as THREE.Mesh;
  clone.updateMatrixWorld(true);
  try {
    const exporter = new GLTFExporter();
    const out = await exporter.parseAsync(clone, {
      binary: true,
      onlyVisible: true,
      embedImages: true,
    });
    let buf: ArrayBuffer;
    if (out instanceof ArrayBuffer) buf = out;
    else if (out instanceof Uint8Array) buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    else throw new Error('GLB 导出未返回二进制数据');
    const blob = new Blob([buf], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.glb') ? filename : `${filename}.glb`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } finally {
    disposeExportCloneGeometry(clone);
  }
}
