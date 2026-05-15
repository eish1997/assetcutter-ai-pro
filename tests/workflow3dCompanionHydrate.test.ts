import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { WorkflowAsset } from '../types';
import {
  hydrateWorkflowAsset3dModelsFromCompanion,
  hydrateWorkflowAssetAfter3dPersist,
  patchWorkflowAssetsWith3dResultAndHydrate,
} from '../services/workflow3dCompanionHydrate';
import * as workflowCompanionAssets from '../services/workflowCompanionAssets';
import * as workflowModelBlob from '../services/workflowModelBlob';
import * as workflowGenerate3dAssetPatch from '../services/workflowGenerate3dAssetPatch';

const baseAsset = (over: Partial<WorkflowAsset> = {}): WorkflowAsset => ({
  id: 'a1',
  original: 'data:image/png;base64,xx',
  displayKey: 'gen3d',
  results: {},
  resultOrder: [],
  archived: false,
  hiddenInGrid: false,
  createdAt: 1,
  ...over,
});

describe('workflow3dCompanionHydrate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrateWorkflowAsset3dModelsFromCompanion fills empty slot from companion', async () => {
    vi.spyOn(workflowModelBlob, 'shouldKeepExistingWorkflowModelSlotUrl').mockResolvedValue(false);
    vi.spyOn(workflowCompanionAssets, 'fetchWorkflowModelFromCompanionAsObjectUrl').mockResolvedValue({
      ok: true,
      objectUrl: 'blob:hydrated-glb',
      mime: 'model/gltf-binary',
    });

    const asset = baseAsset({
      stepModelCompanionKeys: { gen3d: ['models/a1.glb'] },
      stepModelUrls: { gen3d: [''] },
      stepModelFormats: { gen3d: ['glb'] },
    });

    const { nextAsset, revokeBlobUrls } = await hydrateWorkflowAsset3dModelsFromCompanion({
      asset,
      baseUrl: 'http://127.0.0.1:18765',
      projectId: 'proj-1',
    });

    expect(nextAsset.stepModelUrls?.gen3d?.[0]).toBe('blob:hydrated-glb');
    expect(revokeBlobUrls).toEqual([]);
  });

  it('hydrateWorkflowAssetAfter3dPersist also restores preview image', async () => {
    vi.spyOn(workflowModelBlob, 'shouldKeepExistingWorkflowModelSlotUrl').mockResolvedValue(true);
    vi.spyOn(workflowModelBlob, 'isWorkflowModelUrlReadable').mockResolvedValue(false);
    vi.spyOn(workflowCompanionAssets, 'fetchWorkflowOriginalFromCompanionAsObjectUrl').mockResolvedValue({
      ok: true,
      objectUrl: 'blob:preview-jpg',
      mime: 'image/jpeg',
    });

    const asset = baseAsset({
      resultsCompanionKeys: { gen3d: 'previews/a1.jpg' },
      results: { gen3d: '' },
    });

    const { nextAsset } = await hydrateWorkflowAssetAfter3dPersist({
      asset,
      baseUrl: 'http://127.0.0.1:18765',
      projectId: 'proj-1',
    });

    expect(nextAsset.results?.gen3d).toBe('blob:preview-jpg');
  });

  it('patchWorkflowAssetsWith3dResultAndHydrate patches then hydrates target asset', async () => {
    const patchedAsset = baseAsset({
      id: 'wf1',
      stepModelCompanionKeys: { gen3d: ['models/wf1.glb'] },
      stepModelUrls: { gen3d: [''] },
    });
    vi.spyOn(workflowGenerate3dAssetPatch, 'patchWorkflowAssetsWith3dResult').mockReturnValue([patchedAsset]);
    vi.spyOn(workflowModelBlob, 'shouldKeepExistingWorkflowModelSlotUrl').mockResolvedValue(false);
    vi.spyOn(workflowCompanionAssets, 'fetchWorkflowModelFromCompanionAsObjectUrl').mockResolvedValue({
      ok: true,
      objectUrl: 'blob:from-companion',
      mime: 'model/gltf-binary',
    });
    vi.spyOn(workflowModelBlob, 'isWorkflowModelUrlReadable').mockResolvedValue(true);

    const { assets } = await patchWorkflowAssetsWith3dResultAndHydrate({
      prev: [],
      workflowAssetId: 'wf1',
      preset: { id: 'gen3d', label: '生成3D' },
      imageBase64: 'data:image/png;base64,xx',
      resultKey: 'gen3d',
      localModelUrls: [''],
      modelCompanionKeys: ['models/wf1.glb'],
      stepModelFormats: ['glb'],
      localPreviewUrl: '',
      previewCompanionKey: '',
      jobMeta: { tripoTaskId: 'task-1' },
      companionBaseUrl: 'http://127.0.0.1:18765',
      companionProjectId: 'proj-1',
    });

    expect(assets[0]?.stepModelUrls?.gen3d?.[0]).toBe('blob:from-companion');
  });
});
