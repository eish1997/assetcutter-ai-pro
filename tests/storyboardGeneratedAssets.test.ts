import { describe, expect, it } from 'vitest';
import type { StoryboardTableRow } from '../types';
import {
  appendStoryboardGeneratedImageHistoryBatch,
  backfillStoryboardGeneratedImageHistory,
  collectStoryboardGeneratedAssets,
  listStoryboardGeneratedImageAssets,
  normalizeStoryboardGeneratedImageHistory,
} from '../services/storyboardGeneratedAssets';

const row = (partial: Partial<StoryboardTableRow>): StoryboardTableRow => ({
  id: partial.id || 'r1',
  index: partial.index ?? 0,
  shotFields: partial.shotFields ?? {},
  shotText: partial.shotText ?? '',
  ...partial,
});

describe('storyboardGeneratedAssets', () => {
  it('collectStoryboardGeneratedAssets keeps redraw/sheet_split history sorted newest first', () => {
    const rows = [
      row({
        id: 'a',
        shotNo: '001',
        frameImage: 'data:image/png;base64,current',
        frameImageHistory: [
          {
            id: 'v-new',
            createdAt: 200,
            source: 'sheet_split',
            frameImage: 'data:image/png;base64,current',
          },
          {
            id: 'v-old',
            createdAt: 100,
            source: 'redraw',
            frameImage: 'data:image/png;base64,old',
          },
          {
            id: 'v-upload',
            createdAt: 50,
            source: 'upload',
            frameImage: 'data:image/png;base64,upload',
          },
        ],
      }),
    ];

    const assets = collectStoryboardGeneratedAssets(rows);
    expect(assets).toHaveLength(2);
    expect(assets[0]?.versionId).toBe('v-new');
    expect(assets[1]?.versionId).toBe('v-old');
    expect(assets[0]?.isCurrent).toBe(true);
  });

  it('collectStoryboardGeneratedAssets dedupes identical refs', () => {
    const rows = [
      row({
        id: 'a',
        shotNo: '002',
        frameImage: 'data:image/png;base64,same',
        frameImageHistory: [
          {
            id: 'v1',
            createdAt: 300,
            source: 'redraw',
            frameImage: 'data:image/png;base64,same',
          },
          {
            id: 'v2',
            createdAt: 200,
            source: 'redraw',
            frameImage: 'data:image/png;base64,same',
          },
        ],
      }),
    ];
    expect(collectStoryboardGeneratedAssets(rows)).toHaveLength(1);
  });

  it('backfillStoryboardGeneratedImageHistory merges row history into persisted list', () => {
    const persisted = normalizeStoryboardGeneratedImageHistory([
      {
        id: 'p1',
        rowId: 'a',
        createdAt: 500,
        source: 'redraw',
        frameImage: 'data:image/png;base64,persisted',
      },
    ]);
    const rows = [
      row({
        id: 'a',
        frameImageHistory: [
          {
            id: 'v-row',
            createdAt: 100,
            source: 'sheet_split',
            frameImage: 'data:image/png;base64,from-row',
          },
        ],
      }),
    ];
    const backfilled = backfillStoryboardGeneratedImageHistory(persisted, rows);
    expect(backfilled).toHaveLength(2);
    expect(backfilled.map((item) => item.id)).toEqual(expect.arrayContaining(['p1', 'v-row']));
  });

  it('listStoryboardGeneratedImageAssets prefers persisted history over duplicate row refs', () => {
    const rows = [
      row({
        id: 'a',
        shotNo: '003',
        frameImage: 'data:image/png;base64,same',
        frameImageHistory: [
          {
            id: 'v1',
            createdAt: 100,
            source: 'redraw',
            frameImage: 'data:image/png;base64,same',
          },
        ],
      }),
    ];
    const persisted = [
      {
        id: 'p-dup',
        rowId: 'a',
        shotNo: '003',
        createdAt: 200,
        source: 'redraw' as const,
        frameImage: 'data:image/png;base64,same',
      },
    ];
    expect(listStoryboardGeneratedImageAssets(rows, persisted)).toHaveLength(1);
    expect(listStoryboardGeneratedImageAssets(rows, persisted)[0]?.id).toBe('p-dup');
  });

  it('listStoryboardGeneratedImageAssets prefers hydrated record over stale row blob', () => {
    const rows = [
      row({
        id: 'a',
        shotNo: '020',
        frameImageHistory: [
          {
            id: 'v1',
            createdAt: 100,
            source: 'sheet_split',
            frameImage: 'blob:stale-from-row',
            frameImageCompanionKey: 'ck-1',
          },
        ],
      }),
    ];
    const persisted = normalizeStoryboardGeneratedImageHistory([
      {
        id: 'v1',
        rowId: 'a',
        shotNo: '020',
        createdAt: 100,
        source: 'sheet_split',
        frameImage: 'blob:fresh-from-record',
        frameImageCompanionKey: 'ck-1',
      },
    ]);
    const assets = listStoryboardGeneratedImageAssets(rows, persisted);
    expect(assets).toHaveLength(1);
    expect(assets[0]?.displaySrc).toBe('blob:fresh-from-record');
  });

  it('listStoryboardGeneratedImageAssets keeps companion-only records pending hydrate', () => {
    const rows = [row({ id: 'a', shotNo: '021' })];
    const persisted = normalizeStoryboardGeneratedImageHistory([
      {
        id: 'v-pending',
        rowId: 'a',
        shotNo: '021',
        createdAt: 100,
        source: 'redraw',
        frameImageCompanionKey: 'ck-pending',
      },
    ]);
    expect(listStoryboardGeneratedImageAssets(rows, persisted)).toHaveLength(1);
  });

  it('appendStoryboardGeneratedImageHistoryBatch prepends newest and dedupes refs', () => {
    const next = appendStoryboardGeneratedImageHistoryBatch(
      [
        {
          id: 'old',
          rowId: 'a',
          createdAt: 100,
          source: 'redraw',
          frameImage: 'data:image/png;base64,old',
        },
      ],
      [
        {
          id: 'new',
          rowId: 'a',
          createdAt: 200,
          source: 'sheet_split',
          frameImage: 'data:image/png;base64,new',
        },
        {
          id: 'dup-old',
          rowId: 'b',
          createdAt: 150,
          source: 'redraw',
          frameImage: 'data:image/png;base64,old',
        },
      ]
    );
    expect(next).toHaveLength(2);
    expect(next.map((item) => item.id)).toEqual(expect.arrayContaining(['new', 'dup-old']));
    expect(next.some((item) => item.frameImage?.includes('old'))).toBe(true);
  });
});
