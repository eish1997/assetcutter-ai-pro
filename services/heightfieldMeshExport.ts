import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

export type HeightfieldMeshExportFormat = 'glb' | 'gltf' | 'obj' | 'stl' | 'fbx';

/** 仅释放克隆体几何；材质/贴图可能与场景网格共享引用，不可 dispose。 */
function disposeExportCloneGeometry(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry?.dispose();
  });
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * needle FBXExporter 对 `MeshMatcapMaterial` / matcap 贴图支持不完整，Maya 等易导入为空。
 * 导出前换为 Lambert + 烘焙世界矩阵，便于 DCC 识别几何。
 */
function prepareHeightfieldMeshForFbxExport(mesh: THREE.Mesh): void {
  mesh.updateMatrixWorld(true);

  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const lamberts = mats.map((m) => {
    const mm = m as THREE.MeshMatcapMaterial;
    if (mm.isMeshMatcapMaterial) {
      return new THREE.MeshLambertMaterial({
        name: mm.name || 'heightfield',
        color: mm.color.clone(),
        side: mm.side,
      });
    }
    return m;
  });
  mesh.material = lamberts.length === 1 ? lamberts[0]! : lamberts;

  const geom = mesh.geometry.clone();
  geom.applyMatrix4(mesh.matrixWorld);
  mesh.geometry.dispose();
  mesh.geometry = geom;
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  mesh.quaternion.identity();
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);
}

/**
 * 将当前高度场网格按格式导出并触发浏览器下载（克隆后导出，不改动场景内原网格）。
 */
export async function downloadHeightfieldMesh(
  mesh: THREE.Mesh,
  format: HeightfieldMeshExportFormat,
  baseName: string
): Promise<void> {
  const clone = mesh.clone(true) as THREE.Mesh;
  if (!clone.name) clone.name = 'heightfield';
  clone.updateMatrixWorld(true);
  const safeBase = baseName.replace(/\.(glb|gltf|obj|stl|fbx)$/i, '') || 'heightfield-export';

  try {
    switch (format) {
      case 'glb': {
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
        triggerBlobDownload(new Blob([buf], { type: 'model/gltf-binary' }), `${safeBase}.glb`);
        return;
      }
      case 'gltf': {
        const exporter = new GLTFExporter();
        const out = await exporter.parseAsync(clone, {
          binary: false,
          onlyVisible: true,
          embedImages: true,
        });
        if (typeof out !== 'string') throw new Error('glTF 导出未返回 JSON 文本');
        triggerBlobDownload(new Blob([out], { type: 'model/gltf+json' }), `${safeBase}.gltf`);
        return;
      }
      case 'obj': {
        const exporter = new OBJExporter();
        const str = exporter.parse(clone);
        triggerBlobDownload(new Blob([str], { type: 'text/plain;charset=utf-8' }), `${safeBase}.obj`);
        return;
      }
      case 'stl': {
        const exporter = new STLExporter();
        const out = exporter.parse(clone, { binary: true });
        if (!(out instanceof DataView)) throw new Error('STL 二进制导出失败');
        triggerBlobDownload(new Blob([out.buffer], { type: 'model/stl' }), `${safeBase}.stl`);
        return;
      }
      case 'fbx': {
        const { FBXExporter } = await import('./vendor/needle-fbx-exporter/FBXExporter.js');
        prepareHeightfieldMeshForFbxExport(clone);
        const exporter = new FBXExporter();
        /** 直接导出 Mesh（避免多一层 Scene→Null）；不嵌入贴图，MatCap 已替换为纯色 Lambert */
        const result = await exporter.export(clone, { binary: true, embedTextures: false });
        const data = result.fbxData;
        const blob =
          typeof data === 'string'
            ? new Blob([data], { type: 'application/octet-stream' })
            : new Blob([data], { type: 'application/octet-stream' });
        triggerBlobDownload(blob, `${safeBase}.fbx`);
        return;
      }
      default: {
        const _exhaustive: never = format;
        throw new Error(`不支持的导出格式: ${_exhaustive}`);
      }
    }
  } finally {
    disposeExportCloneGeometry(clone);
  }
}
