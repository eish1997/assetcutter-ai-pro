import { describe, expect, it } from 'vitest';
import type { WorkflowAsset } from '../types';
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
  });
});
