import { describe, expect, it } from 'vitest';
import type { StoryboardTableRow } from '../types';
import {
  appendStoryboardFrameHistory,
  normalizeStoryboardFrameHistory,
  restoreStoryboardRowFrameVersion,
  storyboardFrameHistoryVersionNeedsCompanionHydrate,
  storyboardFrameRefsEqual,
  trimStoryboardFrameHistory,
} from '../services/storyboardFrameHistory';
import { prepareWorkflowBundleAfterLoad } from '../services/workflowCompanionAssets';
import type { WorkflowAsset } from '../types';

const row = (partial: Partial<StoryboardTableRow>): StoryboardTableRow => ({
  id: partial.id || 'r1',
  index: partial.index ?? 0,
  shotFields: partial.shotFields ?? {},
  shotText: partial.shotText ?? '',
  ...partial,
});

describe('storyboardFrameHistory', () => {
  it('normalizes history entries', () => {
    const items = normalizeStoryboardFrameHistory([
      { id: 'v1', createdAt: 1, source: 'redraw', frameImage: 'data:image/png;base64,abc' },
      { id: '', source: 'redraw', frameImage: 'x' },
      null,
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe('redraw');
  });

  it('detects equal frame refs', () => {
    expect(
      storyboardFrameRefsEqual(
        { frameImage: 'data:x', frameImageObjectKey: 'k1' },
        { frameImage: 'data:x', frameImageObjectKey: 'k1' }
      )
    ).toBe(true);
    expect(
      storyboardFrameRefsEqual(
        { frameImage: 'data:x' },
        { frameImage: 'data:y' }
      )
    ).toBe(false);
  });

  it('appends inline frame to history without companion', async () => {
    const baseRow = row({
      frameImage: 'data:image/png;base64,old',
    });
    const history = await appendStoryboardFrameHistory(baseRow, 'redraw', {
      assetId: 'a1',
      companionBaseUrl: '',
      companionProjectId: '',
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.source).toBe('redraw');
    expect(history[0]?.frameImage).toContain('data:image');
  });

  it('restores a historical version and archives current', async () => {
    const current = row({
      frameImage: 'data:image/png;base64,current',
      frameImageHistory: [
        {
          id: 'v-old',
          createdAt: 1,
          source: 'upload',
          frameImage: 'data:image/png;base64,old',
        },
      ],
    });
    const patch = await restoreStoryboardRowFrameVersion(current, 'v-old', {
      assetId: 'a1',
      companionBaseUrl: '',
      companionProjectId: '',
    });
    expect(patch?.frameImage).toContain('old');
    expect(patch?.frameImageHistory?.some((item) => item.source === 'restore')).toBe(true);
    expect(patch?.frameImageHistory?.some((item) => item.id === 'v-old')).toBe(false);
  });

  it('trims history to limit', () => {
    const long = Array.from({ length: 20 }, (_, i) => ({
      id: `v${i}`,
      createdAt: i,
      source: 'redraw' as const,
      frameImage: `data:${i}`,
    }));
    expect(trimStoryboardFrameHistory(long)).toHaveLength(12);
  });

  it('detects history versions needing companion hydrate after load strip', () => {
    const version = {
      id: 'v1',
      createdAt: 1,
      source: 'redraw' as const,
      frameImageCompanionKey: 'hist-ck-1',
    };
    expect(storyboardFrameHistoryVersionNeedsCompanionHydrate(version)).toBe(true);
    expect(
      storyboardFrameHistoryVersionNeedsCompanionHydrate({
        ...version,
        frameImage: 'blob:http://localhost/x',
      })
    ).toBe(false);
  });

  it('prepareWorkflowBundleAfterLoad strips history inline refs when companion key exists', () => {
    const asset: WorkflowAsset = {
      id: 'sb1',
      assetKind: 'storyboard_table',
      displayKey: 'original',
      original: '',
      storyboardTable: {
        fieldCatalog: [],
        rows: [
          {
            id: 'r1',
            index: 0,
            shotFields: {},
            shotText: '',
            frameImageHistory: [
              {
                id: 'v1',
                createdAt: 1,
                source: 'redraw',
                frameImage: 'data:image/png;base64,abc',
                frameImageCompanionKey: 'hist-ck',
              },
            ],
          },
        ],
      },
    };
    const out = prepareWorkflowBundleAfterLoad({ assets: [asset], pending: [] });
    const hist = out.assets[0]?.storyboardTable?.rows[0]?.frameImageHistory?.[0];
    expect(hist?.frameImage).toBe('');
    expect(hist?.frameImageCompanionKey).toBe('hist-ck');
  });
});
