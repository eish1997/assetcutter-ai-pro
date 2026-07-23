import { describe, expect, it } from 'vitest';
import type { CompanionManifestV1 } from '../services/companionClient/storage';
import {
  collectReferencedCompanionKeys,
  findCompanionKeysMissingFromManifest,
  mergeUnlinkedManifestEntriesIntoWorkflowAssets,
  removeMissingCompanionKeyReferences,
} from '../services/workflowManifestCrossCheck';
import {
  workflowModelCompanionStorageKey,
  workflowOriginalModelCompanionStorageKey,
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
  it('does not report legacy result keys as missing when their stable key exists', () => {
    const m = man([
      {
        key: workflowResultCompanionStorageKey('asset-1', 'ac_internal_quick_compose_plain_i2i'),
        relPath: 'a',
        byteSize: 1,
        tags: [],
        lineage: null,
        updatedAt: 1,
        mime: 'image/png',
      },
    ]);
    const asset = {
      id: 'asset-1',
      original: '',
      displayKey: 'ac_internal_quick_compose_plain_i2i',
      results: {},
      resultsCompanionKeys: {
        ac_internal_quick_compose_plain_i2i: 'asset-1/ac_internal_quick_compose_plain_i2i',
      },
      resultOrder: ['ac_internal_quick_compose_plain_i2i'],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    } satisfies WorkflowAsset;

    expect(findCompanionKeysMissingFromManifest([asset], m)).toEqual([]);
  });

  it('removes only missing companion references from a broken project asset', () => {
    const asset = {
      id: 'asset-1',
      original: '',
      originalCompanionKey: 'missing-orig',
      displayKey: 'step-a',
      results: { 'step-a': '', 'step-b': 'blob:keep' },
      resultsCompanionKeys: { 'step-a': 'missing-result', 'step-b': 'wf-res-asset-1-step-b' },
      resultOrder: ['step-a', 'step-b'],
      modelCompanionKeys: ['missing-model'],
      stepModelCompanionKeys: { 'step-a': ['missing-model'] },
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    } satisfies WorkflowAsset;
    const gaps = findCompanionKeysMissingFromManifest(
      [asset],
      man([
        {
          key: 'wf-res-asset-1-step-b',
          relPath: 'b',
          byteSize: 1,
          tags: [],
          lineage: null,
          updatedAt: 1,
          mime: 'image/png',
        },
      ])
    );

    const cleaned = removeMissingCompanionKeyReferences([asset], gaps);

    expect(cleaned.removed).toBe(3);
    expect(cleaned.assets[0]?.originalCompanionKey).toBeUndefined();
    expect(cleaned.assets[0]?.resultsCompanionKeys).toEqual({ 'step-b': 'wf-res-asset-1-step-b' });
    expect(cleaned.assets[0]?.modelCompanionKeys).toBeUndefined();
    expect(cleaned.assets[0]?.stepModelCompanionKeys).toBeUndefined();
    expect(cleaned.assets[0]?.resultOrder).toEqual(['step-a', 'step-b']);
  });

  it('collects step-scoped 3D companion keys as referenced assets', () => {
    const keys = collectReferencedCompanionKeys([
      {
        id: ASSET_ID,
        original: '',
        displayKey: 'generate_3d',
        results: {},
        resultOrder: ['generate_3d'],
        archived: false,
        hiddenInGrid: false,
        createdAt: 1,
        stepModelCompanionKeys: { generate_3d: ['wf-mdl-step-glb', 'wf-mdl-step-fbx'] },
      },
    ]);

    expect([...keys].sort()).toEqual(['wf-mdl-step-fbx', 'wf-mdl-step-glb']);
  });

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

  it('默认不导入非 wf-* 遗留条目（避免打开项目时扫盘插入多张散卡）', () => {
    const m = man([
      {
        key: 'legacy-blob-key-1',
        relPath: 'imports/snap.png',
        byteSize: 1,
        tags: [],
        lineage: null,
        updatedAt: 1,
        mime: 'image/png',
      },
    ]);
    const { nextAssets, importedKeys } = mergeUnlinkedManifestEntriesIntoWorkflowAssets([], m, () => 'new-1');
    expect(nextAssets.length).toBe(0);
    expect(importedKeys.length).toBe(0);
  });

  it('importLegacyOrphans 为 true 时仍导入遗留条目', () => {
    const m = man([
      {
        key: 'legacy-blob-key-1',
        relPath: 'imports/snap.png',
        byteSize: 1,
        tags: [],
        lineage: null,
        updatedAt: 1,
        mime: 'image/png',
      },
    ]);
    const { nextAssets, importedKeys } = mergeUnlinkedManifestEntriesIntoWorkflowAssets([], m, () => 'new-1', {
      importLegacyOrphans: true,
    });
    expect(nextAssets.length).toBe(1);
    expect(importedKeys).toEqual(['legacy-blob-key-1']);
  });
  it('restores typed original model source files as model slots, not image originals', () => {
    const mk = workflowOriginalModelCompanionStorageKey(ASSET_ID, 'fbx');
    const m = man([
      {
        key: mk,
        relPath: `assets/${mk}`,
        byteSize: 1,
        tags: [],
        lineage: null,
        updatedAt: 1,
        mime: 'application/vnd.autodesk.fbx',
      },
    ]);
    const { nextAssets, importedKeys } = mergeUnlinkedManifestEntriesIntoWorkflowAssets([], m, () => 'x');
    expect(nextAssets.length).toBe(1);
    expect(nextAssets[0]!.id).toBe(ASSET_ID);
    expect(nextAssets[0]!.originalCompanionKey).toBeUndefined();
    expect(nextAssets[0]!.modelCompanionKeys?.[0]).toBe(mk);
    expect(importedKeys).toEqual([mk]);
  });
});
