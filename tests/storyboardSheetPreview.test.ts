import { describe, expect, it, vi } from 'vitest';
import * as clientPersist from '../services/clientPersist';
import {
  buildSheetPreviewLabel,
  createSheetPreviewItem,
  ensureStoryboardRowsForShotNos,
  expandStoryboardShotNoRange,
  formatSheetPreviewShotLabel,
  isStoryboardSheetPreviewSplittable,
  mergeStoryboardSheetPreviews,
  parseSheetPreviewShotRange,
  prependStoryboardSheetPreview,
  readStoryboardSheetPreviews,
  removeStoryboardSheetPreview,
  resolveSheetTaskRows,
  storyboardSheetPreviewListCompanionKey,
  writeStoryboardSheetPreviews,
} from '../services/storyboardSheetPreview';
import { createStoryboardTableRow } from '../services/storyboardTableAsset';

describe('storyboardSheetPreview', () => {
  const assetId = 'test-asset-preview';

  it('normalizes malformed preview records on read', () => {
    vi.spyOn(clientPersist, 'readLocalJson').mockImplementation((_key, fallback, normalize) => {
      const parsed = [
        {
          id: 'p1',
          imageDataUrl: 'data:image/png;base64,abc',
          rowIds: 'bad',
          shotNos: null,
        },
      ];
      if (!normalize) return fallback;
      const normalized = normalize(parsed);
      return normalized ?? fallback;
    });

    const items = readStoryboardSheetPreviews(assetId);
    expect(items).toHaveLength(1);
    expect(items[0]?.rowIds).toEqual([]);
    expect(items[0]?.shotNos).toEqual([]);
    expect(items[0]?.source).toBe('generated');
    vi.restoreAllMocks();
  });

  it('reads companion-only preview metadata', () => {
    vi.spyOn(clientPersist, 'readLocalJson').mockImplementation((_key, fallback, normalize) => {
      const parsed = [
        {
          id: 'p-companion',
          imageCompanionKey: 'companion-key-1',
          label: '任务 1',
          source: 'generated',
          rowIds: ['r1'],
          shotNos: ['SC01'],
        },
      ];
      if (!normalize) return fallback;
      const normalized = normalize(parsed);
      return normalized ?? fallback;
    });

    const items = readStoryboardSheetPreviews(assetId);
    expect(items).toHaveLength(1);
    expect(items[0]?.imageCompanionKey).toBe('companion-key-1');
    expect(items[0]?.imageDataUrl).toBe('');
    vi.restoreAllMocks();
  });

  it('reads idb-only preview metadata', () => {
    vi.spyOn(clientPersist, 'readLocalJson').mockImplementation((_key, fallback, normalize) => {
      const parsed = [
        {
          id: 'p-idb',
          imageIdbKey: 'asset::p-idb',
          label: '任务 2',
          source: 'generated',
          rowIds: [],
          shotNos: [],
        },
      ];
      if (!normalize) return fallback;
      const normalized = normalize(parsed);
      return normalized ?? fallback;
    });

    const items = readStoryboardSheetPreviews(assetId);
    expect(items[0]?.imageIdbKey).toBe('asset::p-idb');
    vi.restoreAllMocks();
  });

  it('creates preview item with stable defaults', () => {
    const item = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,abc',
      label: '任务 1',
      source: 'generated',
      rowIds: ['r1'],
      shotNos: ['SC01'],
    });
    expect(item.matchedCount).toBe(0);
    expect(item.id).toMatch(/^sheet-/);
  });

  it('merge keeps newest duplicate ids and preserves all unique ids', () => {
    const older = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,one',
      label: '1',
      source: 'generated',
      rowIds: [],
      shotNos: [],
      matchedCount: 1,
    });
    const newer = { ...older, matchedCount: 2, createdAt: older.createdAt + 1000 };
    const other = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,two',
      label: '2',
      source: 'generated',
      rowIds: [],
      shotNos: [],
    });
    const merged = mergeStoryboardSheetPreviews([older, other], [newer]);
    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.id === older.id)?.matchedCount).toBe(2);
  });

  it('prepend chains from currentItems instead of stale storage', () => {
    const first = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,one',
      label: '1',
      source: 'generated',
      rowIds: [],
      shotNos: [],
    });
    const second = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,two',
      label: '2',
      source: 'generated',
      rowIds: [],
      shotNos: [],
    });

    vi.spyOn(clientPersist, 'readLocalJson').mockReturnValue([]);
    const writeSpy = vi.spyOn(clientPersist, 'writeLocalStringOrThrow').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    const result = prependStoryboardSheetPreview(assetId, second, [first]);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.id).toBe(second.id);
    expect(result.items[1]?.id).toBe(first.id);
    expect(result.persisted).toBe(false);

    writeSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('strips inline image when writing companion-backed preview', () => {
    const item = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,huge',
      label: '任务 1',
      source: 'generated',
      rowIds: [],
      shotNos: [],
    });
    item.imageCompanionKey = 'companion-key-1';

    const writeSpy = vi.spyOn(clientPersist, 'writeLocalStringOrThrow').mockImplementation((_, raw) => {
      const parsed = JSON.parse(raw) as Array<{ imageDataUrl?: string; imageCompanionKey?: string }>;
      expect(parsed[0]?.imageCompanionKey).toBe('companion-key-1');
      expect(parsed[0]?.imageDataUrl).toBeUndefined();
    });

    expect(writeStoryboardSheetPreviews(assetId, [item])).toBe(true);
    writeSpy.mockRestore();
  });

  it('strips inline image when writing idb-backed preview', () => {
    const item = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,huge',
      label: '任务 1',
      source: 'generated',
      rowIds: [],
      shotNos: [],
    });
    item.imageIdbKey = 'asset::sheet-1';

    const writeSpy = vi.spyOn(clientPersist, 'writeLocalStringOrThrow').mockImplementation((_, raw) => {
      const parsed = JSON.parse(raw) as Array<{ imageDataUrl?: string; imageIdbKey?: string }>;
      expect(parsed[0]?.imageIdbKey).toBe('asset::sheet-1');
      expect(parsed[0]?.imageDataUrl).toBeUndefined();
    });

    expect(writeStoryboardSheetPreviews(assetId, [item])).toBe(true);
    writeSpy.mockRestore();
  });

  it('reports persistence failure without throwing', () => {
    const spy = vi
      .spyOn(clientPersist, 'writeLocalStringOrThrow')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    const item = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,abc',
      label: 'big',
      source: 'uploaded',
      rowIds: [],
      shotNos: [],
    });
    const result = prependStoryboardSheetPreview(assetId, item);
    expect(result.items).toHaveLength(1);
    expect(result.persisted).toBe(false);
    spy.mockRestore();
    clientPersist.removeLocalKey(`ac_storyboard_sheet_preview_v1__${assetId}__guest`);
  });

  it('removes preview by id and returns removed item', () => {
    const uploaded = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,up',
      label: '上传拼图',
      source: 'uploaded',
      rowIds: ['r1'],
      shotNos: ['01'],
    });
    const generated = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,gen',
      label: '任务 1',
      source: 'generated',
      rowIds: ['r2'],
      shotNos: ['02'],
    });
    const current = [uploaded, generated];
    const result = removeStoryboardSheetPreview(assetId, uploaded.id, current);
    expect(result.removed?.id).toBe(uploaded.id);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(generated.id);
  });

  it('merge keeps in-memory imageDataUrl over storage metadata', () => {
    const stored = createSheetPreviewItem({
      imageDataUrl: '',
      imageCompanionKey: 'companion-key',
      label: '任务 1',
      source: 'generated',
      rowIds: ['r1'],
      shotNos: ['01'],
    });
    const memory = {
      ...stored,
      imageDataUrl: 'data:image/png;base64,live',
      genStatus: 'done' as const,
    };
    const merged = mergeStoryboardSheetPreviews([stored], [memory]);
    expect(merged[0]?.imageDataUrl).toBe('data:image/png;base64,live');
    expect(merged[0]?.genStatus).toBe('done');
  });

  it('detects splittable previews with image and unmatched shots', () => {
    const done = createSheetPreviewItem({
      imageDataUrl: 'data:image/png;base64,x',
      label: '任务 1',
      source: 'generated',
      rowIds: ['r1', 'r2'],
      shotNos: ['01', '02'],
      genStatus: 'done',
      matchedCount: 0,
    });
    const pending = { ...done, id: 'p2', genStatus: 'pending' as const };
    const companionOnly = {
      ...done,
      id: 'p3',
      imageDataUrl: '',
      imageCompanionKey: 'key-1',
    };
    expect(isStoryboardSheetPreviewSplittable(done)).toBe(true);
    expect(isStoryboardSheetPreviewSplittable(pending)).toBe(false);
    expect(isStoryboardSheetPreviewSplittable({ ...done, matchedCount: 2 })).toBe(true);
    expect(isStoryboardSheetPreviewSplittable(companionOnly)).toBe(true);
    expect(
      isStoryboardSheetPreviewSplittable({
        ...done,
        id: 'p4',
        imageDataUrl: '',
        imageCompanionKey: undefined,
        imageIdbKey: undefined,
      })
    ).toBe(false);
  });

  it('uses stable companion key for sheet preview list index', () => {
    expect(storyboardSheetPreviewListCompanionKey('asset-1')).toContain('asset-1');
    expect(storyboardSheetPreviewListCompanionKey('asset-1')).toContain('sheet-previews-index');
  });

  it('expands shot ranges and formats preview labels', () => {
    expect(expandStoryboardShotNoRange('01', '04')).toEqual(['001', '002', '003', '004']);
    expect(expandStoryboardShotNoRange('41', '45')).toEqual(['041', '042', '043', '044', '045']);
    expect(formatSheetPreviewShotLabel(['001', '002', '003', '004'])).toBe('001–004');
    expect(buildSheetPreviewLabel('任务 1', ['01', '02'])).toBe('任务 1 · 01、02');
    expect(parseSheetPreviewShotRange('01', '04')).toEqual({
      ok: true,
      shotNos: ['001', '002', '003', '004'],
    });
  });

  it('creates missing rows for preview shot numbers', () => {
    const existing = [createStoryboardTableRow({ id: 'r1', shotNo: '01' }, 0)];
    const ensured = ensureStoryboardRowsForShotNos(existing, ['01', '02', '03']);
    expect(ensured.rows.map((row) => row.shotNo)).toEqual(['001', '002', '003']);
    expect(ensured.createdIds).toHaveLength(2);
    expect(ensured.nextTableRows).toHaveLength(3);
  });

  it('resolveSheetTaskRows prefers shotNos over stale rowIds', () => {
    const rows = [
      createStoryboardTableRow({ id: 'r1', shotNo: '131' }, 0),
      createStoryboardTableRow({ id: 'r2', shotNo: '132' }, 1),
      createStoryboardTableRow({ id: 'r3', shotNo: '133' }, 2),
    ];
    const resolved = resolveSheetTaskRows(rows, ['stale-id'], ['131', '132', '133']);
    expect(resolved.map((row) => row.shotNo)).toEqual(['131', '132', '133']);
  });

  it('resolveSheetTaskRows matches padded shot numbers', () => {
    const rows = [createStoryboardTableRow({ id: 'r1', shotNo: '0131' }, 0)];
    const resolved = resolveSheetTaskRows(rows, [], ['131']);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.id).toBe('r1');
  });

  it('ensureStoryboardRowsForShotNos reuses padded existing rows instead of duplicating', () => {
    const existing = [createStoryboardTableRow({ id: 'r1', shotNo: '0131' }, 0)];
    const ensured = ensureStoryboardRowsForShotNos(existing, ['131']);
    expect(ensured.createdIds).toHaveLength(0);
    expect(ensured.rows).toHaveLength(1);
    expect(ensured.rows[0]?.id).toBe('r1');
  });

  it('ensureStoryboardRowsForShotNos upgrades two-digit rows to three-digit and avoids duplicates', () => {
    const existing = [
      { ...createStoryboardTableRow({ id: 'r1' }, 0), shotNo: '01' },
      { ...createStoryboardTableRow({ id: 'r2' }, 1), shotNo: '02' },
    ];
    const ensured = ensureStoryboardRowsForShotNos(existing, ['001', '002', '003']);
    expect(ensured.createdIds).toHaveLength(1);
    expect(ensured.nextTableRows.map((row) => row.shotNo)).toEqual(['001', '002', '003']);
    expect(ensured.nextTableRows).toHaveLength(3);
  });

  it('merge prefers in-memory imageDataUrl and newer matchedCount', () => {
    const stored = createSheetPreviewItem({
      imageDataUrl: '',
      imageCompanionKey: 'companion-key',
      label: '任务 1',
      source: 'generated',
      rowIds: ['r1'],
      shotNos: ['01'],
      matchedCount: 2,
    });
    const memory = {
      ...stored,
      imageDataUrl: 'data:image/png;base64,live',
      genStatus: 'done' as const,
      matchedCount: 0,
    };
    const merged = mergeStoryboardSheetPreviews([stored], [memory]);
    expect(merged[0]?.imageDataUrl).toBe('data:image/png;base64,live');
    expect(merged[0]?.matchedCount).toBe(0);
  });

  it('does not persist pending placeholders to storage', () => {
    const pending = createSheetPreviewItem({
      imageDataUrl: '',
      label: '任务 1',
      source: 'generated',
      rowIds: ['r1'],
      shotNos: ['01'],
      genStatus: 'pending',
    });
    const writeSpy = vi.spyOn(clientPersist, 'writeLocalStringOrThrow').mockImplementation((_, raw) => {
      expect(JSON.parse(raw)).toEqual([]);
    });
    expect(writeStoryboardSheetPreviews(assetId, [pending])).toBe(true);
    writeSpy.mockRestore();
  });

  it('applyHydratedSheetPreviewImages overlays fresh display urls', async () => {
    const { applyHydratedSheetPreviewImages } = await import('../services/storyboardSheetPreview');
    const stale = createSheetPreviewItem({
      id: 'p-stale',
      imageDataUrl: 'blob:http://localhost/dead',
      label: '上传拼图',
      source: 'uploaded',
      rowIds: [],
      shotNos: ['01'],
      genStatus: 'done',
    });
    const fresh = {
      ...stale,
      imageDataUrl: 'blob:http://localhost/fresh',
    };
    const merged = applyHydratedSheetPreviewImages([stale], [fresh]);
    expect(merged[0]?.imageDataUrl).toBe('blob:http://localhost/fresh');
  });
});
