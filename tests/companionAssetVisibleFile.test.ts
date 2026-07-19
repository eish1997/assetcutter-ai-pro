import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureAssetVisibleObjectFile,
  putAsset,
} from '../local-companion/src/storage/assetBlob.ts';
import {
  getAssetObjectPath,
  getAssetVisibleObjectPath,
} from '../local-companion/src/storage/projectPaths.ts';

let volumeRoot = '';

function useTempVolume() {
  volumeRoot = mkdtempSync(join(tmpdir(), 'assetcutter-companion-'));
  vi.stubEnv('COMPANION_VOLUME_ROOT', volumeRoot);
  return volumeRoot;
}

afterEach(() => {
  vi.unstubAllEnvs();
  if (volumeRoot) {
    rmSync(volumeRoot, { recursive: true, force: true });
    volumeRoot = '';
  }
});

describe('local companion asset visible files', () => {
  it('keeps object compatibility and writes a visible image suffix file', () => {
    useTempVolume();

    putAsset('project-a', 'asset_png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png');

    expect(existsSync(getAssetObjectPath('project-a', 'asset_png').objectFile)).toBe(true);
    expect(existsSync(getAssetVisibleObjectPath('project-a', 'asset_png', 'asset.png').visibleFile)).toBe(true);
  });

  it('writes model suffix files and can backfill a visible file before reveal', () => {
    useTempVolume();

    putAsset('project-a', 'mesh_glb', Buffer.from('glTF'), 'model/gltf-binary');
    const visible = ensureAssetVisibleObjectFile('project-a', 'mesh_glb', 'model/gltf-binary');

    expect('ok' in visible && visible.ok).toBe(true);
    expect(existsSync(getAssetVisibleObjectPath('project-a', 'mesh_glb', 'model.glb').visibleFile)).toBe(true);
  });
});
