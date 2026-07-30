import { describe, expect, it } from 'vitest';
import {
  resolveWorkflowAssetPbrEditDoc,
  workflowPbrEditDocMatchesModel,
  writeWorkflowAssetStepPbrEdit,
  type WorkflowModelPbrEditDoc,
} from '../services/workflowModelPbrEdits';

function makeDoc(modelKey: string, variantId?: string): WorkflowModelPbrEditDoc {
  return {
    version: 1,
    assetId: 'asset-1',
    ...(variantId ? { variantId } : {}),
    modelKey,
    updatedAt: 1,
    materials: {
      'mat-0': {
        slots: {
          baseColor: {
            dataUrl: `data:image/png;base64,${modelKey}`,
            fileName: `${modelKey}.png`,
            channel: 'rgb',
            colorSpace: 'srgb',
            enabled: true,
            updatedAt: 1,
          },
        },
      },
    },
  };
}

describe('stepModelPbrEdits per model version', () => {
  it('does not reuse legacy modelPbrEdits from another model version', () => {
    const docA = makeDoc('model-a', 'step-a');
    const asset = {
      displayKey: 'step-b',
      modelPbrEdits: docA,
    };
    expect(
      resolveWorkflowAssetPbrEditDoc(asset, {
        stepKey: 'step-b',
        variantId: 'step-b',
        modelKey: 'model-b',
      })
    ).toBeNull();
  });

  it('reads the matching stepModelPbrEdits slot', () => {
    const docA = makeDoc('model-a', 'step-a');
    const docB = makeDoc('model-b', 'step-b');
    const asset = writeWorkflowAssetStepPbrEdit(
      writeWorkflowAssetStepPbrEdit({ displayKey: 'step-b' }, 'step-a', docA),
      'step-b',
      docB
    );
    const resolved = resolveWorkflowAssetPbrEditDoc(asset, {
      stepKey: 'step-b',
      variantId: 'step-b',
      modelKey: 'model-b',
    });
    expect(resolved?.modelKey).toBe('model-b');
    expect(resolved?.materials['mat-0']?.slots.baseColor?.dataUrl).toContain('model-b');
  });

  it('does not reuse another step via modelKey when stepKey is explicit and empty', () => {
    const docA = makeDoc('shared-key', 'step-a');
    const asset = writeWorkflowAssetStepPbrEdit({ displayKey: 'step-b' }, 'step-a', docA);
    expect(
      resolveWorkflowAssetPbrEditDoc(asset, {
        stepKey: 'step-b',
        variantId: 'step-b',
        modelKey: 'shared-key',
      })
    ).toBeNull();
  });

  it('workflowPbrEditDocMatchesModel requires exact variantId when provided', () => {
    const doc = makeDoc('model-a', 'step-a');
    expect(workflowPbrEditDocMatchesModel(doc, { modelKey: 'model-a' })).toBe(true);
    expect(workflowPbrEditDocMatchesModel(doc, { variantId: 'step-a' })).toBe(true);
    expect(workflowPbrEditDocMatchesModel(doc, { variantId: 'step-b', modelKey: 'model-a' })).toBe(false);
    // No variant on doc: must not match a viewer that knows its version (prevents cross-atlas).
    const legacy = makeDoc('model-a');
    expect(workflowPbrEditDocMatchesModel(legacy, { variantId: 'step-a', modelKey: 'model-a' })).toBe(false);
  });
});
