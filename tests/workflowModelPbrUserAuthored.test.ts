import { describe, expect, it } from 'vitest';
import {
  pbrEditDocHasUserAuthoredTextures,
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
});
