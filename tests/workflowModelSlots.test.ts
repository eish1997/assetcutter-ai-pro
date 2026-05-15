import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import {
  applyPersisted3dSlotsToWorkflowAsset,
  inferTencentModuleFromWorkflowMeta,
  normalizePersist3dModelsForBundleTruth,
  resolveWorkflowStepModelSlots,
} from '../services/workflowModelSlots';

describe('workflowModelSlots', () => {
  it('resolveWorkflowStepModelSlots merges urls keys formats', () => {
    const asset = {
      id: 'a1',
      original: 'x',
      displayKey: 'tripo_test',
      results: {},
      resultOrder: ['tripo_test'],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      stepModelUrls: { tripo_test: ['blob:glb'] },
      stepModelCompanionKeys: { tripo_test: ['key-glb', 'key-fbx'] },
      stepModelFormats: { tripo_test: ['glb', 'fbx'] },
    } as WorkflowAsset;
    const slots = resolveWorkflowStepModelSlots(asset, 'tripo_test');
    expect(slots).toHaveLength(2);
    expect(slots[0]?.format).toBe('glb');
    expect(slots[1]?.companionKey).toBe('key-fbx');
  });

  it('applyPersisted3dSlotsToWorkflowAsset patches step fields', () => {
    const asset = {
      id: 'a2',
      original: 'x',
      displayKey: 'hunyuan_pro',
      results: {},
      resultOrder: ['hunyuan_pro'],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      resultMeta: { hunyuan_pro: { executedAt: 1, tencentJobId: 'job1' } },
    } as WorkflowAsset;
    const { nextAsset } = applyPersisted3dSlotsToWorkflowAsset({
      asset,
      metaKey: 'hunyuan_pro',
      persisted: {
        modelUrls: ['blob:new'],
        modelCompanionKeys: ['wf-mdl-a2-0'],
        stepModelFormats: ['glb'],
        modelSourceName: 'wf-mdl-a2-0',
      },
      jobMeta: { tencentJobId: 'job1', tencentLastError: undefined },
    });
    expect(nextAsset.stepModelUrls?.hunyuan_pro).toEqual(['']);
    expect(nextAsset.stepModelCompanionKeys?.hunyuan_pro).toEqual(['wf-mdl-a2-0']);
  });

  it('normalizePersist3dModelsForBundleTruth strips blob when companion keys exist', () => {
    const normalized = normalizePersist3dModelsForBundleTruth({
      modelUrls: ['blob:glb', 'blob:fbx'],
      modelCompanionKeys: ['key-glb', 'key-fbx'],
      stepModelFormats: ['glb', 'fbx'],
      preview: { objectUrl: 'blob:prev', companionKey: 'key-prev' },
    });
    expect(normalized.modelUrls).toEqual(['', '']);
    expect(normalized.preview?.objectUrl).toBe('');
  });

  it('inferTencentModuleFromWorkflowMeta detects rapid', () => {
    const asset = {
      id: 'a3',
      original: 'x',
      displayKey: 'hunyuan_rapid',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      resultMeta: { hunyuan_rapid: { executedAt: 1, presetActionIdSnapshot: 'preset_hunyuan_rapid' } },
    } as WorkflowAsset;
    expect(inferTencentModuleFromWorkflowMeta(asset, 'hunyuan_rapid')).toBe('rapid');
  });
});
