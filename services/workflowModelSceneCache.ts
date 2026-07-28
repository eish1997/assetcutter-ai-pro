import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone as cloneSkinnedObject } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { disposeObjectHierarchy, inferModelFormat, type ModelFormat } from './workflowModelThreeShared';

const MAX_CACHED_MODELS = 4;

type CacheEntry = {
  key: string;
  root: THREE.Object3D;
  lastUsed: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<THREE.Object3D>>();

const stats = {
  parseLoads: 0,
  cacheHits: 0,
  cacheMisses: 0,
};

function srcFileCacheKey(src: string, fileName?: string): string {
  return `${String(src || '').trim()}::${String(fileName || '').trim()}`;
}

function isEphemeralModelRef(value: string): boolean {
  return /^(blob:|data:)/i.test(value);
}

/**
 * Prefer asset/companion identity over ephemeral blob/data URLs so reopen
 * and parent re-renders do not thrash the parse cache or remount the viewer.
 */
export function resolveWorkflowModelSceneCacheKey(opts: {
  src: string;
  fileName?: string;
  assetId?: string;
  variantId?: string;
  modelKey?: string;
}): string {
  const assetId = String(opts.assetId || '').trim();
  const variantId = String(opts.variantId || '').trim();
  const modelKey = String(opts.modelKey || '').trim();
  const fileName = String(opts.fileName || '').trim();
  const stableModelKey = modelKey && !isEphemeralModelRef(modelKey) ? modelKey : '';
  if (assetId && (stableModelKey || variantId || fileName)) {
    return ['asset', assetId, variantId || 'original', stableModelKey || fileName || 'model'].join('::');
  }
  if (stableModelKey) return `model::${stableModelKey}`;
  return srcFileCacheKey(opts.src, opts.fileName);
}

function touch(entry: CacheEntry): void {
  entry.lastUsed = Date.now();
  cache.delete(entry.key);
  cache.set(entry.key, entry);
}

function evictIfNeeded(): void {
  while (cache.size > MAX_CACHED_MODELS) {
    const oldest = cache.values().next().value as CacheEntry | undefined;
    if (!oldest) break;
    cache.delete(oldest.key);
    disposeObjectHierarchy(oldest.root);
  }
}

function loadModelOnce(src: string, format: ModelFormat, fileName?: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    if (format === 'gltf') {
      new GLTFLoader().load(src, (gltf) => resolve(gltf.scene), undefined, reject);
      return;
    }
    if (format === 'fbx') {
      new FBXLoader().load(src, (group) => resolve(group), undefined, reject);
      return;
    }
    if (format === 'obj') {
      new OBJLoader().load(src, (group) => resolve(group), undefined, reject);
      return;
    }
    reject(new Error(`unsupported model format: ${fileName || src}`));
  });
}

/** Clone hierarchy with own materials so clay/PBR edits cannot poison the cache template. */
export function cloneWorkflowModelScene(template: THREE.Object3D): THREE.Object3D {
  const cloned = cloneSkinnedObject(template);
  cloned.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((m) => (m ? m.clone() : m));
    } else if (obj.material) {
      obj.material = obj.material.clone();
    }
  });
  return cloned;
}

/**
 * Release a preview instance created by {@link cloneWorkflowModelScene}.
 * Do not dispose materials/textures here: clones share GPU texture sources with the
 * cache template, and disposing them can blank the next warm-pool reopen.
 */
export function disposeWorkflowModelSceneInstance(_root: THREE.Object3D): void {
  /* no-op: scene.remove(root) is enough; GC collects orphaned cloned materials */
}

async function ensureTemplate(key: string, src: string, fileName?: string): Promise<THREE.Object3D> {
  const hit = cache.get(key);
  if (hit) {
    touch(hit);
    stats.cacheHits += 1;
    return hit.root;
  }

  let pending = inflight.get(key);
  if (!pending) {
    const format = inferModelFormat(src, fileName);
    stats.cacheMisses += 1;
    stats.parseLoads += 1;
    pending = loadModelOnce(src, format, fileName)
      .then((root) => {
        // Always cache a successful parse. Caller abort must NOT dispose this template —
        // React StrictMode / overlapping opens share the same inflight promise.
        const entry: CacheEntry = { key, root, lastUsed: Date.now() };
        cache.set(key, entry);
        evictIfNeeded();
        return root;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, pending);
  } else {
    stats.cacheHits += 1;
  }

  const template = await pending;
  const entry = cache.get(key);
  if (entry) touch(entry);
  return template;
}

/**
 * Load (or reuse) a parsed model and return an isolated clone for the live viewer.
 */
export async function acquireWorkflowModelSceneInstance(opts: {
  src: string;
  fileName?: string;
  /** Stable identity (asset/companion); avoids blob: URL cache misses */
  cacheKey?: string;
  assetId?: string;
  variantId?: string;
  modelKey?: string;
  signal?: AbortSignal;
}): Promise<{ root: THREE.Object3D; fromCache: boolean; cacheKey: string }> {
  const src = String(opts.src || '').trim();
  if (!src) throw new Error('empty model src');
  const key =
    String(opts.cacheKey || '').trim() ||
    resolveWorkflowModelSceneCacheKey({
      src,
      fileName: opts.fileName,
      assetId: opts.assetId,
      variantId: opts.variantId,
      modelKey: opts.modelKey,
    });
  const hadBefore = cache.has(key) || inflight.has(key);
  const template = await ensureTemplate(key, src, opts.fileName);
  if (opts.signal?.aborted) {
    throw new DOMException('aborted', 'AbortError');
  }
  return { root: cloneWorkflowModelScene(template), fromCache: hadBefore, cacheKey: key };
}

export function getWorkflowModelSceneCacheStats(): {
  size: number;
  parseLoads: number;
  cacheHits: number;
  cacheMisses: number;
  inflight: number;
} {
  return {
    size: cache.size,
    parseLoads: stats.parseLoads,
    cacheHits: stats.cacheHits,
    cacheMisses: stats.cacheMisses,
    inflight: inflight.size,
  };
}

/** @internal vitest */
export function resetWorkflowModelSceneCacheForTests(): void {
  for (const entry of cache.values()) disposeObjectHierarchy(entry.root);
  cache.clear();
  inflight.clear();
  stats.parseLoads = 0;
  stats.cacheHits = 0;
  stats.cacheMisses = 0;
}

/** @internal vitest */
export function workflowModelSceneCacheSizeForTests(): number {
  return cache.size;
}
