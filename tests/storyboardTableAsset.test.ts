import { describe, expect, it } from 'vitest';
import {
  applyAutoShotNumbers,
  computeStoryboardTableStats,
  createEmptyStoryboardTableAsset,
  createStoryboardTableRow,
  duplicateStoryboardTableOnAsset,
  formatStoryboardShotNo,
  isWorkflowStoryboardTableAsset,
  normalizeStoryboardTableDoc,
  normalizeStoryboardTableOnAsset,
  readStoryboardTableTitleRaw,
  reindexStoryboardRows,
  resolveStoryboardTableTitle,
  sortStoryboardRowsByShotNo,
  storyboardTableCoverImage,
  storyboardTablePreviewImages,
} from '../services/storyboardTableAsset';

describe('storyboardTableAsset', () => {
  it('creates table asset with three default rows', () => {
    const a = createEmptyStoryboardTableAsset('tbl-1', '第 1 集');
    expect(isWorkflowStoryboardTableAsset(a)).toBe(true);
    expect(a.storyboardTable?.rows).toHaveLength(3);
    expect(a.storyboardTable?.fieldCatalog).toEqual([]);
    expect(a.storyboardTable?.rows?.map((row) => row.shotNo)).toEqual(['001', '002', '003']);
    expect(a.storyboardTable?.rows?.[0]?.shotFields).toEqual({});
    expect(a.textTitle).toBe('第 1 集');
  });

  it('recognizes legacy storyboard payload without assetKind', () => {
    const legacy = {
      id: 'tbl-legacy',
      original: '',
      displayKey: 'original',
      results: {},
      storyboardTable: {
        rows: [{ id: 'r1', index: 0, shotText: 'hello' }],
      },
    } as import('../types').WorkflowAsset;
    expect(isWorkflowStoryboardTableAsset(legacy)).toBe(true);
    const upgraded = normalizeStoryboardTableOnAsset({ ...legacy, assetKind: 'storyboard_table' });
    expect(upgraded.assetKind).toBe('storyboard_table');
    expect(upgraded.storyboardTable?.rows).toHaveLength(1);
  });

  it('reindexes rows after reorder', () => {
    const rows = normalizeStoryboardTableDoc({
      rows: [
        { id: 'a', index: 5, shotText: 'x' },
        { id: 'b', index: 9, shotText: 'y' },
      ],
    }).rows;
    const swapped = reindexStoryboardRows([rows[1]!, rows[0]!]);
    expect(swapped[0]?.index).toBe(0);
    expect(swapped[1]?.index).toBe(1);
  });

  it('preserves empty title while editing', () => {
    const normalized = normalizeStoryboardTableOnAsset({
      id: 't-empty',
      assetKind: 'storyboard_table',
      textTitle: '',
      original: '',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      storyboardTable: { title: '分镜表', rows: [] },
    });
    expect(normalized.textTitle).toBe('');
    expect(normalized.storyboardTable?.title).toBe('');
    expect(resolveStoryboardTableTitle(normalized)).toBe('分镜表');
    expect(readStoryboardTableTitleRaw(normalized)).toBe('');
  });

  it('strips group fields from storyboard table asset', () => {
    const normalized = normalizeStoryboardTableOnAsset({
      id: 't1',
      assetKind: 'storyboard_table',
      isGroup: true,
      assetIds: ['x'],
      original: 'data:image/png;base64,abc',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
      storyboardTable: { rows: [] },
    });
    expect(normalized.isGroup).toBeUndefined();
    expect(normalized.assetIds).toBeUndefined();
    expect(normalized.original).toBe('');
  });

  it('computes stats with duration gaps', () => {
    const stats = computeStoryboardTableStats({
      rows: [
        { id: '1', index: 0, shotText: '', durationSec: 2, locked: true },
        { id: '2', index: 1, shotText: '', durationSec: null, locked: false },
      ],
    });
    expect(stats.rowCount).toBe(2);
    expect(stats.lockedCount).toBe(1);
    expect(stats.totalDurationSec).toBe(2);
    expect(stats.hasGaps).toBe(true);
  });

  it('applyAutoShotNumbers fills empty shotNo and normalizes numeric padding', () => {
    const rows = applyAutoShotNumbers([
      { id: 'a', index: 0, shotText: '', shotNo: '' },
      { id: 'b', index: 1, shotText: '', shotNo: '自定义' },
      { id: 'c', index: 2, shotText: '', shotNo: '01' },
    ] as never);
    expect(rows[0]?.shotNo).toBe('001');
    expect(rows[1]?.shotNo).toBe('自定义');
    expect(rows[2]?.shotNo).toBe('001');
  });

  it('sortStoryboardRowsByShotNo keeps unnumbered rows first then sorts numbered rows', () => {
    const sorted = sortStoryboardRowsByShotNo([
      { id: 'c', index: 0, shotText: '', shotNo: '010' },
      { id: 'a', index: 1, shotText: '', shotNo: '' },
      { id: 'b', index: 2, shotText: '', shotNo: '002' },
      { id: 'd', index: 3, shotText: '', shotNo: '' },
    ] as never);
    expect(sorted.map((row) => row.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(sorted.map((row) => row.index)).toEqual([0, 1, 2, 3]);
  });

  it('createStoryboardTableRow with blank shotNo stays unnumbered', () => {
    const row = createStoryboardTableRow({ shotNo: '' }, 2);
    expect(row.shotNo).toBeUndefined();
  });

  it('preview images capped', () => {
    const a = createEmptyStoryboardTableAsset('t3');
    const many = {
      ...a,
      storyboardTable: {
        rows: Array.from({ length: 6 }, (_, i) => ({
          id: String(i),
          index: i,
          shotText: '',
          frameImage: `data:image/png;base64,${i}`,
        })),
      },
    };
    expect(storyboardTablePreviewImages(many, 4)).toHaveLength(4);
  });

  it('cover image uses first row with frameImage', () => {
    const a = createEmptyStoryboardTableAsset('t2');
    const withImg = {
      ...a,
      storyboardTable: {
        rows: [
          { id: '1', index: 0, shotText: '', frameImage: '' },
          { id: '2', index: 1, shotText: '', frameImage: 'data:image/png;base64,xx' },
        ],
      },
    };
    expect(storyboardTableCoverImage(withImg)).toContain('data:image');
  });

  it('duplicateStoryboardTableOnAsset assigns new asset and row ids', () => {
    const src = createEmptyStoryboardTableAsset('tbl-src', '源表');
    const rowIds = (src.storyboardTable?.rows ?? []).map((r) => r.id);
    const copy = duplicateStoryboardTableOnAsset(src, 'tbl-copy');
    expect(copy.id).toBe('tbl-copy');
    expect(copy.textTitle).toBe('源表');
    const copyRowIds = (copy.storyboardTable?.rows ?? []).map((r) => r.id);
    expect(copyRowIds).toHaveLength(rowIds.length);
    for (const id of copyRowIds) {
      expect(rowIds).not.toContain(id);
    }
  });
});
