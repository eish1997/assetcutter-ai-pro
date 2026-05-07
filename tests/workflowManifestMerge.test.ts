import { describe, expect, it } from 'vitest';
import type { CompanionManifestV1 } from '../services/companionClient/storage';
import { mergeUnlinkedManifestEntriesIntoWorkflowAssets } from '../services/workflowManifestCrossCheck';
import {
  workflowModelCompanionStorageKey,
  workflowOriginalCompanionStorageKey,
  workflowResultCompanionStorageKey,
} from '../services/workflowCompanionAssets';
import type { WorkflowAsset } from '../types';

const ASSET_ID = '550e8400-e29b-41d4-a716-446655440000';
const STEP = 'generate_single_v1';

function man(entries: CompanionManifestV1['entries']): CompanionManifestV1 {
  return { layoutVersion: 1, projectId: 'p1', updatedAt: 1, entries };
}

describe('mergeUnlinkedManifestEntriesIntoWorkflowAssets', () => {
  it('将 wf-orig 与 wf-res 合并为一张卡片且 id 与伴侣键一致', () => {
    const ok = workflowOriginalCompanionStorageKey(ASSET_ID);
    const rk = workflowResultCompanionStorageKey(ASSET_ID, STEP);
    const m = man([
      { key: ok, relPath: 'a', byteSize: 1, tags: [], lineage: null, updatedAt: 1, mime: 'image/png' },
      { key: rk, relPath: 'b', byteSize: 1, tags: [], lineage: null, updatedAt: 1, mime: 'image/png' },
    ]);
    const { nextAssets, importedKeys } = mergeUnlinkedManifestEntriesIntoWorkflowAssets([], m, () => 'new-id-should-not-appear');
    expect(nextAssets.length).toBe(1);
    expect(nextAssets[0]!.id).toBe(ASSET_ID);
    expect(nextAssets[0]!.originalCompanionKey).toBe(ok);
    expect(nextAssets[0]!.resultsCompanionKeys?.[STEP]).toBe(rk);
    expect(nextAssets[0]!.resultOrder).toContain(STEP);
    expect(importedKeys).toEqual([ok, rk]);
  });

  it('同资产 wf-mdl 槽位并入同一卡片', () => {
    const ok = workflowOriginalCompanionStorageKey(ASSET_ID);
    const mk = workflowModelCompanionStorageKey(ASSET_ID, 0);
    const m = man([
      { key: ok, relPath: 'a', byteSize: 1, tags: [], lineage: null, updatedAt: 1, mime: 'image/png' },
      { key: mk, relPath: 'b', byteSize: 1, tags: [], lineage: null, updatedAt: 1, mime: 'model/gltf-binary' },
    ]);
    const { nextAssets, importedKeys } = mergeUnlinkedManifestEntriesIntoWorkflowAssets([], m, () => 'x');
    expect(nextAssets.length).toBe(1);
    expect(nextAssets[0]!.id).toBe(ASSET_ID);
    expect(nextAssets[0]!.modelCompanionKeys?.[0]).toBe(mk);
    expect(importedKeys.length).toBe(2);
  });

  it('manifest 仅有 wf-res（无 wf-orig 条目）时仍按 UUID 前缀合并', () => {
    const rk1 = workflowResultCompanionStorageKey(ASSET_ID, 'step_a');
    const rk2 = workflowResultCompanionStorageKey(ASSET_ID, 'step_b');
    const m = man([
      { key: rk1, relPath: 'a', byteSize: 1, tags: [], lineage: null, updatedAt: 1, mime: 'image/png' },
      { key: rk2, relPath: 'b', byteSize: 1, tags: [], lineage: null, updatedAt: 1, mime: 'image/png' },
    ]);
    const { nextAssets } = mergeUnlinkedManifestEntriesIntoWorkflowAssets([], m, () => 'x');
    expect(nextAssets.length).toBe(1);
    expect(nextAssets[0]!.id).toBe(ASSET_ID);
    expect(nextAssets[0]!.resultsCompanionKeys?.step_a).toBe(rk1);
    expect(nextAssets[0]!.resultsCompanionKeys?.step_b).toBe(rk2);
    expect(nextAssets[0]!.originalCompanionKey).toBeUndefined();
  });

  it('已存在画布资产时只补全伴侣键不新建卡片', () => {
    const ok = workflowOriginalCompanionStorageKey(ASSET_ID);
    const rk = workflowResultCompanionStorageKey(ASSET_ID, STEP);
    const existing: WorkflowAsset = {
      id: ASSET_ID,
      original: '',
      originalCompanionKey: ok,
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    };
    const m = man([
      { key: ok, relPath: 'a', byteSize: 1, tags: [], lineage: null, updatedAt: 1 },
      { key: rk, relPath: 'b', byteSize: 1, tags: [], lineage: null, updatedAt: 1, mime: 'image/png' },
    ]);
    const { nextAssets } = mergeUnlinkedManifestEntriesIntoWorkflowAssets([existing], m, () => 'x');
    expect(nextAssets.length).toBe(1);
    expect(nextAssets[0]!.resultsCompanionKeys?.[STEP]).toBe(rk);
  });
});
