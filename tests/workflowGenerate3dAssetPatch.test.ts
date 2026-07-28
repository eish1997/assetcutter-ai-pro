import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
import { RESULT_VER_SEP } from '../components/workflow/workflowIds';
import { patchWorkflowAssetsWith3dResult } from '../services/workflowGenerate3dAssetPatch';

describe('patchWorkflowAssetsWith3dResult', () => {
  it('回填已有资产卡的混元 3D 步骤', () => {
    const prev: WorkflowAsset[] = [
      {
        id: 'a1',
        original: 'data:image/png;base64,x',
        displayKey: 'original',
        results: {},
        resultOrder: [],
        archived: false,
        hiddenInGrid: false,
        createdAt: 1,
      },
    ];
    const next = patchWorkflowAssetsWith3dResult({
      prev,
      task: { assetId: 'a1', actionType: 'hunyuan_pro' },
      preset: { id: 'preset_hunyuan', label: '混元专业版' },
      imageBase64: 'data:image/png;base64,x',
      workflowAssetId: 'a1',
      resultKey: 'hunyuan_pro',
      localModelUrls: ['blob:glb'],
      modelCompanionKeys: ['companion/glb'],
      stepModelFormats: ['glb'],
      modelSourceName: 'tencent_job1.glb',
      localPreviewUrl: 'blob:preview',
      previewCompanionKey: 'companion/preview',
      jobMeta: { tencentJobId: 'job1', tencentLastError: undefined },
    });
    expect(next[0]?.resultOrder).toContain('hunyuan_pro');
    expect(next[0]?.resultMeta?.hunyuan_pro?.tencentJobId).toBe('job1');
    expect(next[0]?.stepModelUrls?.hunyuan_pro).toEqual(['']);
    expect(next[0]?.stepModelCompanionKeys?.hunyuan_pro).toEqual(['companion/glb']);
    expect(next[0]?.results?.hunyuan_pro).toBe('');
    expect(next[0]?.displayKey).toBe('hunyuan_pro');
    expect(next[0]?.vgp?.versionOrder.length).toBeGreaterThan(1);
    const origId = next[0]?.vgp?.originalVersionId;
    const gen = Object.values(next[0]?.vgp?.versionsById || {}).find((v) => v.stepKey === 'hunyuan_pro');
    expect(gen?.parentVersionId).toBe(origId);
  });

  it('同能力第二次生成写入独立 __v__ 版本槽而不覆盖旧模型', () => {
    const versionKey = `hunyuan_pro${RESULT_VER_SEP}m2`;
    const prev: WorkflowAsset[] = [
      {
        id: 'a1',
        original: 'data:image/png;base64,x',
        displayKey: 'hunyuan_pro',
        results: { hunyuan_pro: '' },
        resultOrder: ['hunyuan_pro'],
        stepModelUrls: { hunyuan_pro: [''] },
        stepModelCompanionKeys: { hunyuan_pro: ['companion/old'] },
        resultMeta: {
          hunyuan_pro: {
            executedAt: 1,
            mediaKind: 'model3d',
            displayStepLabel: '混元专业版',
            inputSourceDisplayKeySnapshot: 'original',
          },
        },
        archived: false,
        hiddenInGrid: false,
        createdAt: 1,
      },
    ];
    const withFirst = patchWorkflowAssetsWith3dResult({
      prev,
      task: { assetId: 'a1', actionType: 'hunyuan_pro', resultKey: 'hunyuan_pro', inputSourceDisplayKey: 'original' },
      preset: { id: 'preset_hunyuan', label: '混元专业版' },
      imageBase64: 'data:image/png;base64,x',
      workflowAssetId: 'a1',
      resultKey: 'hunyuan_pro',
      localModelUrls: ['blob:glb'],
      modelCompanionKeys: ['companion/old'],
      stepModelFormats: ['glb'],
      localPreviewUrl: '',
      previewCompanionKey: '',
      jobMeta: { tencentJobId: 'job1', tencentLastError: undefined },
    });
    const next = patchWorkflowAssetsWith3dResult({
      prev: withFirst,
      task: { assetId: 'a1', actionType: 'hunyuan_pro', resultKey: versionKey, inputSourceDisplayKey: 'original' },
      preset: { id: 'preset_hunyuan', label: '混元专业版' },
      imageBase64: 'data:image/png;base64,x',
      workflowAssetId: 'a1',
      resultKey: versionKey,
      localModelUrls: ['blob:glb2'],
      modelCompanionKeys: ['companion/new'],
      stepModelFormats: ['glb'],
      localPreviewUrl: '',
      previewCompanionKey: '',
      jobMeta: { tencentJobId: 'job2', tencentLastError: undefined },
    });
    expect(next[0]?.resultOrder).toEqual(['hunyuan_pro', versionKey]);
    expect(next[0]?.stepModelCompanionKeys?.hunyuan_pro).toEqual(['companion/old']);
    expect(next[0]?.stepModelCompanionKeys?.[versionKey]).toEqual(['companion/new']);
    expect(next[0]?.displayKey).toBe(versionKey);
    const vgp = next[0]?.vgp!;
    const origId = vgp.originalVersionId!;
    const modelParents = Object.values(vgp.versionsById)
      .filter((v) => v.role !== 'original')
      .map((v) => v.parentVersionId);
    expect(modelParents).toEqual([origId, origId]);
  });
});
