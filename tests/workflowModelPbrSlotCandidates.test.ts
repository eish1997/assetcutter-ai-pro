import { describe, expect, it } from 'vitest';
import {
  appendWorkflowPbrSlotCandidates,
  createWorkflowPbrSlotCandidate,
  MAX_PBR_SLOT_CANDIDATES,
  normalizeWorkflowModelPbrEditDoc,
  pickPreferredWorkflowModelPbrEditDoc,
  textureEditFromPbrCandidate,
  type WorkflowModelPbrEditDoc,
} from '../services/workflowModelPbrEdits';

describe('workflowModelPbrEdits slot candidates', () => {
  it('normalizes slotCandidates and activeCandidateIds on material edits', () => {
    const doc = normalizeWorkflowModelPbrEditDoc({
      version: 1,
      assetId: 'a1',
      modelKey: 'm1',
      updatedAt: 1,
      materials: {
        mat0: {
          materialName: 'Body',
          slots: {
            baseColor: {
              dataUrl: 'data:image/png;base64,aaa',
              fileName: 'base.png',
              channel: 'rgb',
              colorSpace: 'srgb',
              enabled: true,
              updatedAt: 1,
            },
          },
          slotCandidates: {
            baseColor: [
              {
                id: 'c1',
                dataUrl: 'data:image/png;base64,bbb',
                fileName: 'gen.png',
                source: 'generate',
                presetId: 'p1',
                createdAt: 2,
              },
              { id: '', dataUrl: 'data:image/png;base64,bad', source: 'upload' },
            ],
          },
          activeCandidateIds: { baseColor: 'c1', normal: '  ' },
        },
      },
    });
    expect(doc?.materials.mat0?.slotCandidates?.baseColor).toHaveLength(1);
    expect(doc?.materials.mat0?.slotCandidates?.baseColor?.[0]?.id).toBe('c1');
    expect(doc?.materials.mat0?.activeCandidateIds).toEqual({ baseColor: 'c1' });
  });

  it('appends candidates with soft cap and builds texture edit from candidate', () => {
    const seed = Array.from({ length: MAX_PBR_SLOT_CANDIDATES }, (_, i) =>
      createWorkflowPbrSlotCandidate({
        dataUrl: `data:image/png;base64,${i}`,
        source: 'upload',
        fileName: `t-${i}.png`,
      })
    );
    const extra = createWorkflowPbrSlotCandidate({
      dataUrl: 'data:image/png;base64,extra',
      source: 'generate',
      presetId: 'preset-x',
    });
    const next = appendWorkflowPbrSlotCandidates(seed, [extra]);
    expect(next).toHaveLength(MAX_PBR_SLOT_CANDIDATES);
    expect(next[next.length - 1]?.dataUrl).toContain('extra');
    const edit = textureEditFromPbrCandidate(extra, 'roughness');
    expect(edit.enabled).toBe(true);
    expect(edit.channel).toBe('g');
    expect(edit.colorSpace).toBe('linear');
  });

  it('pickPreferredWorkflowModelPbrEditDoc keeps richer slotCandidates across remount', () => {
    const staleHost: WorkflowModelPbrEditDoc = {
      version: 1,
      assetId: 'host',
      modelKey: 'm1',
      variantId: 'original',
      updatedAt: 100,
      materials: {
        mat0: {
          materialName: 'Body',
          slots: {},
          slotCandidates: {
            baseColor: [
              createWorkflowPbrSlotCandidate({
                assetId: 'old-tex',
                dataUrl: 'data:image/png;base64,old',
                source: 'generate',
              }),
            ],
          },
        },
      },
    };
    const localFresh: WorkflowModelPbrEditDoc = {
      version: 1,
      assetId: 'host',
      modelKey: 'm1',
      variantId: 'original',
      updatedAt: 90,
      materials: {
        mat0: {
          materialName: 'Body',
          slots: {},
          slotCandidates: {
            baseColor: [
              createWorkflowPbrSlotCandidate({
                assetId: 'old-tex',
                dataUrl: 'data:image/png;base64,old',
                source: 'generate',
              }),
              createWorkflowPbrSlotCandidate({
                assetId: 'new-tex-1',
                dataUrl: 'data:image/png;base64,n1',
                source: 'generate',
              }),
              createWorkflowPbrSlotCandidate({
                assetId: 'new-tex-2',
                dataUrl: 'data:image/png;base64,n2',
                source: 'generate',
              }),
            ],
          },
        },
      },
    };
    const picked = pickPreferredWorkflowModelPbrEditDoc(staleHost, localFresh);
    expect(picked?.materials.mat0?.slotCandidates?.baseColor?.map((c) => c.assetId)).toEqual([
      'old-tex',
      'new-tex-1',
      'new-tex-2',
    ]);
  });
});
