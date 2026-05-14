import type { Object3D, Texture } from 'three';

export interface FBXExportOptions {
  target?: 'Default' | 'Horizon Worlds';
  binary?: boolean;
  embedTextures?: boolean;
}

export interface FBXExportResult {
  target: 'Default' | 'Horizon Worlds';
  format: 'ascii' | 'binary';
  fbxFileName: string;
  fbxData: string | ArrayBuffer;
  files: Record<string, Uint8Array>;
  textures: Texture[];
  zipData: Uint8Array;
}

/** 构建产物来源：https://github.com/needle-tools/three-fbx-exporter（package/dist） */
export declare class FBXExporter {
  export(object: Object3D, options?: FBXExportOptions): Promise<FBXExportResult>;
}
