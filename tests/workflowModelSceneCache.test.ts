import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  acquireWorkflowModelSceneInstance,
  cloneWorkflowModelScene,
  disposeWorkflowModelSceneInstance,
  getWorkflowModelSceneCacheStats,
  resetWorkflowModelSceneCacheForTests,
  workflowModelSceneCacheSizeForTests,
} from '../services/workflowModelSceneCache';
import { normalizeWorkflowModel3dViewState } from '../services/workflowModelThreeShared';

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => {
  class GLTFLoader {
    load(url: string, onLoad: (gltf: { scene: THREE.Object3D }) => void) {
      const root = new THREE.Group();
      root.name = `mock-${url}`;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      root.add(mesh);
      queueMicrotask(() => onLoad({ scene: root }));
    }
  }
  return { GLTFLoader };
});

afterEach(() => {
  resetWorkflowModelSceneCacheForTests();
});

describe('workflowModelSceneCache clones', () => {
  it('clones materials so edits do not poison the template', () => {
    const template = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    template.add(mesh);

    const a = cloneWorkflowModelScene(template);
    const b = cloneWorkflowModelScene(template);
    const meshA = a.children[0] as THREE.Mesh;
    const meshB = b.children[0] as THREE.Mesh;
    expect(meshA.material).not.toBe(mat);
    expect(meshB.material).not.toBe(mat);
    expect(meshA.material).not.toBe(meshB.material);
    (meshA.material as THREE.MeshStandardMaterial).color.set(0x00ff00);
    expect((meshB.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xff0000);
    expect(mat.color.getHex()).toBe(0xff0000);

    disposeWorkflowModelSceneInstance(a);
    disposeWorkflowModelSceneInstance(b);
    expect(workflowModelSceneCacheSizeForTests()).toBe(0);
  });

  it('does not drop cached template when the first waiter aborts', async () => {
    const ac1 = new AbortController();
    const p1 = acquireWorkflowModelSceneInstance({ src: 'https://example.test/a.glb', signal: ac1.signal });
    ac1.abort();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });

    const second = await acquireWorkflowModelSceneInstance({ src: 'https://example.test/a.glb' });
    expect(second.fromCache).toBe(true);
    expect(workflowModelSceneCacheSizeForTests()).toBe(1);
    expect(getWorkflowModelSceneCacheStats().parseLoads).toBe(1);
    disposeWorkflowModelSceneInstance(second.root);
  });

  it('reuses cache across ephemeral blob URLs when asset identity is stable', async () => {
    const first = await acquireWorkflowModelSceneInstance({
      src: 'blob:https://example.test/111',
      fileName: 'hero.glb',
      assetId: 'asset-a',
      variantId: 'original',
      modelKey: 'companion-fbx-1',
    });
    disposeWorkflowModelSceneInstance(first.root);

    const second = await acquireWorkflowModelSceneInstance({
      src: 'blob:https://example.test/222',
      fileName: 'hero.glb',
      assetId: 'asset-a',
      variantId: 'original',
      modelKey: 'companion-fbx-1',
    });
    expect(second.fromCache).toBe(true);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(getWorkflowModelSceneCacheStats().parseLoads).toBe(1);
    disposeWorkflowModelSceneInstance(second.root);
  });
});

describe('normalizeWorkflowModel3dViewState still works', () => {
  it('accepts pose', () => {
    expect(
      normalizeWorkflowModel3dViewState({
        camera: { position: [1, 2, 3], target: [0, 0, 0] },
        updatedAt: 1,
      })?.camera.position
    ).toEqual([1, 2, 3]);
  });
});
