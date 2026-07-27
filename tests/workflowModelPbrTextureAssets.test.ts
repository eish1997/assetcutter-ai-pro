import { describe, expect, it } from 'vitest';
import {
  applyPbrTextureAssetIdToDoc,
  collectPbrTextureAssetIds,
  createWorkflowPbrSlotCandidate,
  diffRemovedPbrTextureAssetIds,
  filterUnreferencedPbrTextureAssetIds,
  listLegacyPbrTextureDataUrlRefs,
  normalizeWorkflowModelPbrEditDoc,
  pbrTextureEditMatchesRewriteSource,
  resolvePbrTextureSrc,
  textureEditFromPbrCandidate,
  type WorkflowModelPbrEditDoc,
} from '../services/workflowModelPbrEdits';

function sampleDoc(overrides?: Partial<WorkflowModelPbrEditDoc>): WorkflowModelPbrEditDoc {
  return {
    version: 1,
    assetId: 'host-3d',
    modelKey: 'model.glb',
    updatedAt: 1,
    materials: {
      mat1: {
        materialName: 'Mat',
        slots: {
          baseColor: {
            dataUrl: 'data:image/png;base64,AA==',
            fileName: 'legacy.png',
            channel: 'rgb',
            colorSpace: 'srgb',
            enabled: true,
            updatedAt: 1,
          },
        },
        slotCandidates: {
          baseColor: [
            {
              id: 'cand-legacy',
              dataUrl: 'data:image/png;base64,BB==',
              fileName: 'cand.png',
              source: 'generate',
              createdAt: 1,
            },
          ],
        },
      },
    },
    ...overrides,
  };
}

describe('workflowModelPbrTextureAssets', () => {
  it('normalizes candidates/slots with assetId and without dataUrl', () => {
    const doc = normalizeWorkflowModelPbrEditDoc({
      version: 1,
      assetId: 'host',
      modelKey: 'm',
      updatedAt: 1,
      materials: {
        m1: {
          slots: {
            baseColor: {
              assetId: 'tex-1',
              fileName: 'a.png',
              channel: 'rgb',
              colorSpace: 'srgb',
              enabled: true,
              updatedAt: 1,
            },
          },
          slotCandidates: {
            baseColor: [{ id: 'tex-1', assetId: 'tex-1', fileName: 'a.png', source: 'generate', createdAt: 1 }],
          },
        },
      },
    });
    expect(doc?.materials.m1?.slots.baseColor?.assetId).toBe('tex-1');
    expect(doc?.materials.m1?.slots.baseColor?.dataUrl).toBeUndefined();
    expect(doc?.materials.m1?.slotCandidates?.baseColor?.[0]?.assetId).toBe('tex-1');
  });

  it('still accepts legacy dataUrl-only records', () => {
    const doc = normalizeWorkflowModelPbrEditDoc(sampleDoc());
    expect(doc?.materials.mat1?.slots.baseColor?.dataUrl).toContain('data:image');
    expect(listLegacyPbrTextureDataUrlRefs(doc).length).toBeGreaterThan(0);
  });

  it('resolvePbrTextureSrc prefers asset lookup then dataUrl', () => {
    expect(
      resolvePbrTextureSrc({ assetId: 'tex-1', dataUrl: 'data:legacy' }, (id) =>
        id === 'tex-1' ? 'blob:tex-1' : ''
      )
    ).toBe('blob:tex-1');
    expect(resolvePbrTextureSrc({ dataUrl: 'data:only' }, () => '')).toBe('data:only');
    expect(resolvePbrTextureSrc({ assetId: 'missing' }, () => '')).toBe('');
  });

  it('createWorkflowPbrSlotCandidate uses assetId as id when provided', () => {
    const cand = createWorkflowPbrSlotCandidate({
      assetId: 'tex-abc',
      dataUrl: 'data:image/png;base64,AA==',
      source: 'generate',
      fileName: 'x.png',
    });
    expect(cand.id).toBe('tex-abc');
    expect(cand.assetId).toBe('tex-abc');
    const edit = textureEditFromPbrCandidate(cand, 'baseColor');
    expect(edit.assetId).toBe('tex-abc');
  });

  it('collects and diffs referenced texture asset ids', () => {
    const before = normalizeWorkflowModelPbrEditDoc({
      version: 1,
      assetId: 'host',
      modelKey: 'm',
      updatedAt: 1,
      materials: {
        m1: {
          slots: {
            baseColor: {
              assetId: 'tex-a',
              fileName: 'a.png',
              channel: 'rgb',
              colorSpace: 'srgb',
              enabled: true,
              updatedAt: 1,
            },
          },
          slotCandidates: {
            baseColor: [
              { id: 'tex-a', assetId: 'tex-a', fileName: 'a.png', source: 'generate', createdAt: 1 },
              { id: 'tex-b', assetId: 'tex-b', fileName: 'b.png', source: 'generate', createdAt: 2 },
            ],
          },
        },
      },
    })!;
    const after = normalizeWorkflowModelPbrEditDoc({
      ...before,
      materials: {
        m1: {
          ...before.materials.m1,
          slotCandidates: {
            baseColor: [{ id: 'tex-a', assetId: 'tex-a', fileName: 'a.png', source: 'generate', createdAt: 1 }],
          },
        },
      },
    })!;
    expect([...collectPbrTextureAssetIds(before)].sort()).toEqual(['tex-a', 'tex-b']);
    expect(diffRemovedPbrTextureAssetIds(before, after)).toEqual(['tex-b']);
  });

  it('applyPbrTextureAssetIdToDoc clears dataUrl and rewrites candidate id', () => {
    const doc = normalizeWorkflowModelPbrEditDoc(sampleDoc())!;
    const next = applyPbrTextureAssetIdToDoc(doc, {
      materialId: 'mat1',
      slot: 'baseColor',
      kind: 'candidate',
      candidateId: 'cand-legacy',
      assetId: 'tex-new',
    });
    const cand = next.materials.mat1?.slotCandidates?.baseColor?.find((c) => c.assetId === 'tex-new');
    expect(cand?.id).toBe('tex-new');
    expect(cand?.dataUrl).toBeUndefined();
  });

  it('filterUnreferencedPbrTextureAssetIds respects other hosts and extras', () => {
    const hostA = normalizeWorkflowModelPbrEditDoc({
      version: 1,
      assetId: 'host-a',
      modelKey: 'm',
      updatedAt: 1,
      materials: {
        m1: {
          slots: {
            baseColor: {
              assetId: 'tex-shared',
              fileName: 'a.png',
              channel: 'rgb',
              colorSpace: 'srgb',
              enabled: true,
              updatedAt: 1,
            },
          },
        },
      },
    })!;
    const assets = [
      { id: 'host-a', modelPbrEdits: hostA },
      { id: 'tex-shared' },
      { id: 'tex-only' },
    ];
    expect(filterUnreferencedPbrTextureAssetIds(['tex-shared', 'tex-only'], assets)).toEqual(['tex-only']);
    expect(
      filterUnreferencedPbrTextureAssetIds(['tex-only'], assets, { extraReferencedIds: ['tex-only'] })
    ).toEqual([]);
  });

  it('pbrTextureEditMatchesRewriteSource matches assetId or dataUrl', () => {
    expect(
      pbrTextureEditMatchesRewriteSource(
        {
          assetId: 'tex-1',
          fileName: 'a.png',
          channel: 'rgb',
          colorSpace: 'srgb',
          enabled: true,
          updatedAt: 1,
        },
        { sourceTextureSrc: 'blob:x', sourceTextureAssetId: 'tex-1' }
      )
    ).toBe(true);
    expect(
      pbrTextureEditMatchesRewriteSource(
        {
          dataUrl: 'data:image/png;base64,AA==',
          fileName: 'a.png',
          channel: 'rgb',
          colorSpace: 'srgb',
          enabled: true,
          updatedAt: 1,
        },
        { sourceTextureSrc: 'data:image/png;base64,AA==' }
      )
    ).toBe(true);
  });
});
