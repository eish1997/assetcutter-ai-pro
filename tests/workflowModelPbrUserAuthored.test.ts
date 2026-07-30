import { describe, expect, it } from 'vitest';
import {
  isWorkflowAssetHiddenFromAssetGrid,
  isWorkflowPbrTextureAsset,
  listLegacyPbrTextureDataUrlRefs,
  pbrEditDocHasUserAuthoredTextures,
  shouldApplyPbrTextureEditToMesh,
  shouldReseedEmbeddedPbrDocFromMesh,
  type WorkflowModelPbrEditDoc,
} from '../services/workflowModelPbrEdits';

describe('pbrEditDocHasUserAuthoredTextures', () => {
  it('treats embedded-only seeds as non-user', () => {
    const doc: WorkflowModelPbrEditDoc = {
      version: 1,
      assetId: 'a',
      modelKey: 'm',
      variantId: 'v1',
      updatedAt: 1,
      materials: {
        'mat-0': {
          slots: {
            baseColor: {
              dataUrl: 'data:image/png;base64,xx',
              fileName: 'b.png',
              channel: 'rgb',
              colorSpace: 'srgb',
              source: 'embedded',
              enabled: true,
              updatedAt: 1,
            },
          },
        },
      },
    };
    expect(pbrEditDocHasUserAuthoredTextures(doc)).toBe(false);
  });

  it('ignores generate candidates alone (must not force mesh re-apply of embedded maps)', () => {
    const doc: WorkflowModelPbrEditDoc = {
      version: 1,
      assetId: 'a',
      modelKey: 'm',
      variantId: 'v1',
      updatedAt: 1,
      materials: {
        'mat-0': {
          slots: {
            baseColor: {
              assetId: 'tex-embedded',
              fileName: 'b.png',
              channel: 'rgb',
              colorSpace: 'srgb',
              source: 'embedded',
              enabled: true,
              updatedAt: 1,
            },
          },
          slotCandidates: {
            baseColor: [
              {
                id: 'cand-1',
                assetId: 'tex-gen',
                fileName: 'gen.png',
                source: 'generate',
                createdAt: 1,
              },
            ],
          },
          params: { roughness: 0.5 },
        },
      },
    };
    expect(pbrEditDocHasUserAuthoredTextures(doc)).toBe(false);
  });

  it('detects user source and legacy assetId', () => {
    expect(
      pbrEditDocHasUserAuthoredTextures({
        version: 1,
        assetId: 'a',
        modelKey: 'm',
        updatedAt: 1,
        materials: {
          'mat-0': {
            slots: {
              baseColor: {
                dataUrl: 'data:image/png;base64,xx',
                fileName: 'b.png',
                channel: 'rgb',
                colorSpace: 'srgb',
                source: 'user',
                enabled: true,
                updatedAt: 1,
              },
            },
          },
        },
      })
    ).toBe(true);
    expect(
      pbrEditDocHasUserAuthoredTextures({
        version: 1,
        assetId: 'a',
        modelKey: 'm',
        updatedAt: 1,
        materials: {
          'mat-0': {
            slots: {
              baseColor: {
                assetId: 'tex-1',
                fileName: 'b.png',
                channel: 'rgb',
                colorSpace: 'srgb',
                enabled: true,
                updatedAt: 1,
              },
            },
          },
        },
      })
    ).toBe(true);
  });

  it('never applies embedded slot edits onto the mesh', () => {
    expect(
      shouldApplyPbrTextureEditToMesh({
        dataUrl: 'data:image/png;base64,xx',
        fileName: 'b.png',
        channel: 'rgb',
        colorSpace: 'srgb',
        source: 'embedded',
        enabled: true,
        updatedAt: 1,
      })
    ).toBe(false);
    expect(
      shouldApplyPbrTextureEditToMesh({
        assetId: 'tex-1',
        fileName: 'b.png',
        channel: 'rgb',
        colorSpace: 'srgb',
        source: 'user',
        enabled: true,
        updatedAt: 1,
      })
    ).toBe(true);
  });
});

describe('PBR texture grid visibility (scheme B)', () => {
  it('identifies capability=pbr_texture assets', () => {
    expect(
      isWorkflowPbrTextureAsset({
        resultMeta: {
          original: { source: { capability: 'pbr_texture' } },
        },
      })
    ).toBe(true);
    expect(
      isWorkflowPbrTextureAsset({
        resultMeta: {
          original: { source: { capability: 'image_gen' } },
        },
      })
    ).toBe(false);
  });

  it('hides pbr textures even when hiddenInGrid flag is lost', () => {
    expect(
      isWorkflowAssetHiddenFromAssetGrid({
        hiddenInGrid: false,
        resultMeta: {
          original: { source: { capability: 'pbr_texture' } },
        },
      })
    ).toBe(true);
    expect(
      isWorkflowAssetHiddenFromAssetGrid({
        hiddenInGrid: true,
        resultMeta: {
          original: { source: { capability: 'image_gen' } },
        },
      })
    ).toBe(true);
    expect(
      isWorkflowAssetHiddenFromAssetGrid({
        hiddenInGrid: false,
        resultMeta: {
          original: { source: { capability: 'image_gen' } },
        },
      })
    ).toBe(false);
  });

  it('does not reseed when a matched persisted doc already exists', () => {
    expect(shouldReseedEmbeddedPbrDocFromMesh(null)).toBe(true);
    expect(
      shouldReseedEmbeddedPbrDocFromMesh({
        version: 1,
        assetId: 'a',
        modelKey: 'm',
        updatedAt: 1,
        materials: {},
      })
    ).toBe(false);
  });

  it('marks embedded slot legacy refs as embedded for promote', () => {
    const refs = listLegacyPbrTextureDataUrlRefs({
      version: 1,
      assetId: 'a',
      modelKey: 'm',
      updatedAt: 1,
      materials: {
        mat1: {
          slots: {
            baseColor: {
              dataUrl: 'data:image/png;base64,AA==',
              fileName: 'atlas.png',
              channel: 'rgb',
              colorSpace: 'srgb',
              source: 'embedded',
              enabled: true,
              updatedAt: 1,
            },
          },
        },
      },
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.source).toBe('embedded');
  });
});
