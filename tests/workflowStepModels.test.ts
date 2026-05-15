import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import {
  inferLegacyWorkflowStepModelOwnerKey,
  resolveWorkflowStepModelUrls,
  getWorkflowStepModelPersistStatus,
  workflowModelPersistStatusLabel,
} from '../services/workflowStepModels';

describe('workflowStepModels', () => {
  it('仅当前步骤返回 3D 模型 URL', () => {
    const asset = {
      id: 'a1',
      original: 'data:image/png;base64,x',
      displayKey: 'step_a',
      results: {},
      resultOrder: ['step_a', 'tripo_test'],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      stepModelUrls: {
        tripo_test: ['blob:model'],
      },
      resultMeta: {
        tripo_test: { executedAt: 1, tripoTaskId: 'tsk_1' },
      },
    } as WorkflowAsset;
    expect(resolveWorkflowStepModelUrls(asset, 'step_a')).toEqual([]);
    expect(resolveWorkflowStepModelUrls(asset, 'tripo_test')).toEqual(['blob:model']);
  });

  it('遗留资产级 modelUrls 仅归属含 tripoTaskId 的步骤', () => {
    const asset = {
      id: 'a2',
      original: 'data:image/png;base64,x',
      displayKey: 'original',
      results: {},
      resultOrder: ['original', 'tripo_test'],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      modelUrls: ['blob:legacy'],
      resultMeta: {
        tripo_test: { executedAt: 1, tripoTaskId: 'tsk_2' },
      },
    } as WorkflowAsset;
    expect(inferLegacyWorkflowStepModelOwnerKey(asset)).toBe('tripo_test');
    expect(resolveWorkflowStepModelUrls(asset, 'original')).toEqual([]);
    expect(resolveWorkflowStepModelUrls(asset, 'tripo_test')).toEqual(['blob:legacy']);
  });

  it('遗留资产级 modelUrls 归属含 tencentJobId 的步骤', () => {
    const asset = {
      id: 'a3',
      original: 'data:image/png;base64,x',
      displayKey: 'original',
      results: {},
      resultOrder: ['original', 'hunyuan_pro'],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      modelUrls: ['blob:tencent-legacy'],
      resultMeta: {
        hunyuan_pro: { executedAt: 1, tencentJobId: 'job_xyz' },
      },
    } as WorkflowAsset;
    expect(inferLegacyWorkflowStepModelOwnerKey(asset)).toBe('hunyuan_pro');
    expect(resolveWorkflowStepModelUrls(asset, 'hunyuan_pro')).toEqual(['blob:tencent-legacy']);
  });

  it('getWorkflowStepModelPersistStatus: persisted when companion keys exist', () => {
    const asset = {
      id: 'a4',
      original: 'data:image/png;base64,x',
      displayKey: 'tripo_test',
      results: {},
      resultOrder: ['tripo_test'],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      stepModelCompanionKeys: { tripo_test: ['key-glb', ''] },
      stepModelFormats: { tripo_test: ['glb', 'fbx'] },
      resultMeta: { tripo_test: { executedAt: 1, tripoTaskId: 'tsk_1' } },
    } as WorkflowAsset;
    const d = getWorkflowStepModelPersistStatus(asset, 'tripo_test');
    expect(d.status).toBe('persisted');
    expect(d.glbOnCompanion).toBe(true);
    expect(d.fbxOnCompanion).toBe(false);
    expect(workflowModelPersistStatusLabel(d)).toContain('已落本机伴侣');
  });

  it('getWorkflowStepModelPersistStatus: memory_only without companion keys', () => {
    const asset = {
      id: 'a5',
      original: 'data:image/png;base64,x',
      displayKey: 'tripo_test',
      results: {},
      resultOrder: ['tripo_test'],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      stepModelUrls: { tripo_test: ['blob:x'] },
    } as WorkflowAsset;
    expect(getWorkflowStepModelPersistStatus(asset, 'tripo_test').status).toBe('memory_only');
  });

  it('getWorkflowStepModelPersistStatus: remote_only with job id only', () => {
    const asset = {
      id: 'a6',
      original: 'data:image/png;base64,x',
      displayKey: 'hunyuan_pro',
      results: {},
      resultOrder: ['hunyuan_pro'],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      resultMeta: { hunyuan_pro: { executedAt: 1, tencentJobId: 'job_1' } },
    } as WorkflowAsset;
    expect(getWorkflowStepModelPersistStatus(asset, 'hunyuan_pro').status).toBe('remote_only');
  });
});
