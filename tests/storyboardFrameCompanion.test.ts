import { describe, expect, it } from 'vitest';
import {
  applyStoryboardFrameCompanionHydrateResults,
  buildStoryboardFrameCompanionHydrateKey,
  listStoryboardFrameCompanionHydrateTasks,
  storyboardFrameCompanionResultKey,
  storyboardRowNeedsCompanionFrameHydrate,
} from '../services/storyboardFrameCompanion';
import { createStoryboardTableRow, normalizeStoryboardTableOnAsset } from '../services/storyboardTableAsset';
import type { StoryboardTableRow, WorkflowAsset } from '../types';

function storyboardAsset(rows: StoryboardTableRow[]): WorkflowAsset {
  return normalizeStoryboardTableOnAsset({
    id: 'asset-1',
    assetKind: 'storyboard_table',
    storyboardTable: {
      title: '分镜表',
      rows,
      fieldCatalog: [],
    },
  });
}

describe('storyboardFrameCompanion', () => {
  it('builds stable companion result key', () => {
    expect(storyboardFrameCompanionResultKey('row-1')).toBe('storyboard-frame-row-1');
  });

  it('detects rows needing hydrate', () => {
    const row: StoryboardTableRow = {
      id: 'r1',
      index: 0,
      shotText: '',
      shotFields: {},
      frameImageCompanionKey: 'ck-1',
    };
    expect(storyboardRowNeedsCompanionFrameHydrate(row)).toBe(true);
    expect(storyboardRowNeedsCompanionFrameHydrate({ ...row, frameImage: 'blob:x' })).toBe(false);
    expect(storyboardRowNeedsCompanionFrameHydrate({ ...row, frameImage: 'data:image/png;base64,abc' })).toBe(
      false
    );
  });

  it('lists hydrate tasks for rows with companion keys', () => {
    const asset = storyboardAsset([
      createStoryboardTableRow({ id: 'r1', shotNo: '01', frameImageCompanionKey: 'ck-1' }, 0),
      createStoryboardTableRow({ id: 'r2', shotNo: '02' }, 1),
    ]);
    expect(listStoryboardFrameCompanionHydrateTasks([asset])).toEqual([
      {
        assetId: 'asset-1',
        rowId: 'r1',
        companionKey: 'ck-1',
        prevImg: '',
      },
    ]);
    expect(buildStoryboardFrameCompanionHydrateKey([asset])).toBe('asset-1:r1:ck-1');
  });

  it('applyStoryboardFrameCompanionHydrateResults patches rows in one pass', () => {
    const asset = storyboardAsset([
      createStoryboardTableRow(
        { id: 'r1', shotNo: '01', frameImageCompanionKey: 'ck-1', frameImage: 'blob:dead' },
        0
      ),
      createStoryboardTableRow({ id: 'r2', shotNo: '02', frameImageCompanionKey: 'ck-2' }, 1),
    ]);
    const next = applyStoryboardFrameCompanionHydrateResults(
      [asset],
      [
        {
          task: {
            assetId: 'asset-1',
            rowId: 'r1',
            companionKey: 'ck-1',
            prevImg: 'blob:dead',
          },
          objectUrl: 'blob:fresh-1',
        },
        {
          task: {
            assetId: 'asset-1',
            rowId: 'r2',
            companionKey: 'ck-2',
            prevImg: '',
          },
          objectUrl: 'blob:fresh-2',
        },
      ]
    );
    expect(next[0]?.storyboardTable?.rows[0]?.frameImage).toBe('blob:fresh-1');
    expect(next[0]?.storyboardTable?.rows[1]?.frameImage).toBe('blob:fresh-2');
  });

  it('applyStoryboardFrameCompanionHydrateResults skips rows cleared before hydrate completes', () => {
    const asset = storyboardAsset([
      createStoryboardTableRow({ id: 'r1', shotNo: '01', frameImageCompanionKey: 'ck-1' }, 0),
    ]);
    const cleared = storyboardAsset([
      createStoryboardTableRow({ id: 'r1', shotNo: '01' }, 0),
    ]);
    const next = applyStoryboardFrameCompanionHydrateResults(
      [cleared],
      [
        {
          task: {
            assetId: 'asset-1',
            rowId: 'r1',
            companionKey: 'ck-1',
            prevImg: '',
          },
          objectUrl: 'blob:fresh-1',
        },
      ]
    );
    expect(next[0]?.storyboardTable?.rows[0]?.frameImage).toBeUndefined();
    expect(asset.storyboardTable?.rows[0]?.frameImageCompanionKey).toBe('ck-1');
  });
});
