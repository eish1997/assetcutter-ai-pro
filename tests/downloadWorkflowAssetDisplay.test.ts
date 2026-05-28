import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { WorkflowAsset } from '../types';

vi.mock('../services/companionClient/storage', () => ({
  fetchCompanionAssetForDownload: vi.fn(),
}));

vi.mock('../services/workflowCompanionAssets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/workflowCompanionAssets')>();
  return {
    ...actual,
    fetchCompanionAssetAsDataUrl: vi.fn(),
    imageSrcToDataUrlForCompanion: vi.fn(async (src: string) => src),
  };
});

vi.mock('../services/workbenchDownloadBridge', () => ({
  downloadBlobPreferWorkbench: vi.fn(async () => true),
}));

vi.mock('../services/downloadFilename', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/downloadFilename')>();
  return actual;
});

import { fetchCompanionAssetForDownload } from '../services/companionClient/storage';
import { fetchCompanionAssetAsDataUrl } from '../services/workflowCompanionAssets';
import {
  collectWorkflowAssetIdsFromDragSources,
  downloadWorkflowAssetDisplay,
  workflowCompanionKeyForDisplay,
} from '../services/downloadWorkflowAssetDisplay';
import { downloadBlobPreferWorkbench } from '../services/workbenchDownloadBridge';

function imageAsset(id: string, extra: Partial<WorkflowAsset> = {}): WorkflowAsset {
  return {
    id,
    original: `data:image/png;base64,${id}`,
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: 1,
    ...extra,
  };
}

describe('workflowCompanionKeyForDisplay', () => {
  it('prefers originalCompanionKey for original display', () => {
    const asset = imageAsset('a1', { originalCompanionKey: 'comp-original' });
    expect(workflowCompanionKeyForDisplay(asset)).toBe('comp-original');
  });

  it('uses resultsCompanionKeys for non-original display', () => {
    const asset = imageAsset('a1', {
      displayKey: 'v2',
      resultsCompanionKeys: { v2: 'comp-v2' },
    });
    expect(workflowCompanionKeyForDisplay(asset)).toBe('comp-v2');
  });
});

describe('downloadWorkflowAssetDisplay', () => {
  beforeEach(() => {
    vi.mocked(fetchCompanionAssetForDownload).mockReset();
    vi.mocked(fetchCompanionAssetAsDataUrl).mockReset();
    vi.mocked(downloadBlobPreferWorkbench).mockReset();
    vi.mocked(downloadBlobPreferWorkbench).mockResolvedValue(true);
  });

  it('downloads full image from companion via desktop bridge when key exists', async () => {
    vi.mocked(fetchCompanionAssetForDownload).mockResolvedValue({
      ok: true,
      data: { blob: new Blob(['full'], { type: 'image/png' }), filename: 'full.png' },
      latencyMs: 1,
      status: 200,
    });
    const asset = imageAsset('thumb', {
      original: 'data:image/png;base64,thumb',
      originalCompanionKey: 'wf-full-key',
    });
    const r = await downloadWorkflowAssetDisplay(asset, {
      getAssetDisplayImage: (a) => a.original,
      getAssetDisplayText: () => '',
      companionBaseUrl: 'http://127.0.0.1:18765',
      companionProjectId: 'proj1',
    });
    expect(r.ok).toBe(true);
    expect(fetchCompanionAssetForDownload).toHaveBeenCalled();
    expect(downloadBlobPreferWorkbench).toHaveBeenCalledWith(
      expect.any(Blob),
      'full.png',
      expect.objectContaining({ noticeTitle: '图片已保存' })
    );
  });

  it('adds extension when companion returns filename without suffix', async () => {
    vi.mocked(fetchCompanionAssetForDownload).mockResolvedValue({
      ok: true,
      data: {
        blob: new Blob(['full'], { type: 'image/png' }),
        filename: 'workflow-thumb',
        mime: 'image/png',
      },
      latencyMs: 1,
      status: 200,
    });
    const asset = imageAsset('thumb', { originalCompanionKey: 'wf-full-key' });
    const r = await downloadWorkflowAssetDisplay(asset, {
      getAssetDisplayImage: (a) => a.original,
      getAssetDisplayText: () => '',
      companionBaseUrl: 'http://127.0.0.1:18765',
      companionProjectId: 'proj1',
    });
    expect(r.ok).toBe(true);
    expect(downloadBlobPreferWorkbench).toHaveBeenCalledWith(
      expect.any(Blob),
      'workflow-thumb.png',
      expect.objectContaining({ noticeTitle: '图片已保存' })
    );
  });

  it('uses companion dataUrl fallback without duplicating file extension', async () => {
    vi.mocked(fetchCompanionAssetForDownload).mockResolvedValue({ ok: false, error: 'offline' });
    vi.mocked(fetchCompanionAssetAsDataUrl).mockResolvedValue('data:image/png;base64,abc');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        blob: async () => new Blob(['abc'], { type: 'image/png' }),
      }))
    );
    const asset = imageAsset('thumb', { originalCompanionKey: 'wf-full-key' });
    const r = await downloadWorkflowAssetDisplay(asset, {
      getAssetDisplayImage: (a) => a.original,
      getAssetDisplayText: () => '',
      companionBaseUrl: 'http://127.0.0.1:18765',
      companionProjectId: 'proj1',
    });
    expect(r.ok).toBe(true);
    expect(downloadBlobPreferWorkbench).toHaveBeenCalledWith(
      expect.any(Blob),
      'workflow-thumb.png',
      expect.objectContaining({ noticeTitle: '图片已保存' })
    );
    vi.unstubAllGlobals();
  });

  it('reports failure when text download is canceled', async () => {
    vi.mocked(downloadBlobPreferWorkbench).mockResolvedValue(false);
    const asset = imageAsset('txt1', {
      assetKind: 'text',
      textTitle: '标题',
      textBody: '正文',
      displayKey: 'original',
      original: '',
    });
    const r = await downloadWorkflowAssetDisplay(asset, {
      getAssetDisplayImage: () => '',
      getAssetDisplayText: (a) => String(a.textBody || ''),
      companionBaseUrl: null,
      companionProjectId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('已取消下载');
  });
});

describe('collectWorkflowAssetIdsFromDragSources', () => {
  it('merges root and group sources uniquely', () => {
    const assets = [imageAsset('g1', { isGroup: true, assetIds: ['c1', 'c2'] })];
    const ids = collectWorkflowAssetIdsFromDragSources(
      [
        { kind: 'root', assetIds: ['a1', 'a2'] },
        { kind: 'group', groupAssetId: 'g1', itemIndexes: [0] },
      ],
      assets,
      (_prev, _gid, indexes) => ({
        nextAssets: assets,
        assetIds: indexes.map((i) => (i === 0 ? 'c1' : 'c2')),
      })
    );
    expect(ids).toEqual(['a1', 'a2', 'c1']);
  });
});
