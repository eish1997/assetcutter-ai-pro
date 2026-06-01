import { compressStoryboardFrameDataUrl } from '../components/storyboard/storyboardFrameImage';
import type { StoryboardSheetPreviewItem } from './storyboardSheetPreview';
import {
  storyboardSheetPreviewCompanionResultKey,
} from './storyboardSheetPreview';
import {
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  imageSrcToDataUrlForCompanion,
  putWorkflowResultImageToCompanion,
} from './workflowCompanionAssets';
import {
  deleteStoryboardSheetPreviewBlob,
  loadStoryboardSheetPreviewBlobAsObjectUrl,
  saveStoryboardSheetPreviewBlob,
  storyboardSheetPreviewBlobIdbKey,
} from './storyboardSheetPreviewBlobIdb';

export const STORYBOARD_SHEET_PREVIEW_HISTORY_LIMIT = 8;

export type StoryboardSheetPreviewImageVersionSource = 'generated' | 'uploaded' | 'regenerate';

export type StoryboardSheetPreviewImageVersion = {
  id: string;
  createdAt: number;
  source: StoryboardSheetPreviewImageVersionSource;
  imageDataUrl?: string;
  imageCompanionKey?: string;
  imageIdbKey?: string;
};

export type SheetPreviewImageRef = Pick<
  StoryboardSheetPreviewItem,
  'imageDataUrl' | 'imageCompanionKey' | 'imageIdbKey'
>;

function newSheetPreviewVersionId(): string {
  return `spv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function storyboardSheetPreviewHistoryCompanionKey(
  previewId: string,
  versionId: string
): string {
  return `${storyboardSheetPreviewCompanionResultKey(previewId)}--hist--${versionId}`;
}

export function sheetPreviewImageRefsEqual(a: SheetPreviewImageRef, b: SheetPreviewImageRef): boolean {
  return (
    String(a.imageDataUrl || '').trim() === String(b.imageDataUrl || '').trim() &&
    String(a.imageCompanionKey || '').trim() === String(b.imageCompanionKey || '').trim() &&
    String(a.imageIdbKey || '').trim() === String(b.imageIdbKey || '').trim()
  );
}

export function normalizeSheetPreviewImageHistory(
  raw: unknown
): StoryboardSheetPreviewImageVersion[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryboardSheetPreviewImageVersion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Partial<StoryboardSheetPreviewImageVersion>;
    const id = String(row.id || '').trim();
    if (!id) continue;
    const source =
      row.source === 'uploaded' || row.source === 'regenerate' || row.source === 'generated'
        ? row.source
        : 'generated';
    const hasRef =
      String(row.imageDataUrl || '').trim() ||
      String(row.imageCompanionKey || '').trim() ||
      String(row.imageIdbKey || '').trim();
    if (!hasRef) continue;
    out.push({
      id,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
      source,
      imageDataUrl: String(row.imageDataUrl || '').trim() || undefined,
      imageCompanionKey: String(row.imageCompanionKey || '').trim() || undefined,
      imageIdbKey: String(row.imageIdbKey || '').trim() || undefined,
    });
  }
  return out.slice(0, STORYBOARD_SHEET_PREVIEW_HISTORY_LIMIT);
}

export function trimSheetPreviewImageHistory(
  history: StoryboardSheetPreviewImageVersion[]
): StoryboardSheetPreviewImageVersion[] {
  return history.slice(0, STORYBOARD_SHEET_PREVIEW_HISTORY_LIMIT);
}

export function sheetPreviewHistoryCount(item: StoryboardSheetPreviewItem): number {
  const historyLen = item.imageHistory?.length ?? 0;
  return historyLen + (String(item.imageDataUrl || '').trim() || item.imageCompanionKey || item.imageIdbKey ? 1 : 0);
}

export function sheetPreviewVersionLabel(
  version: StoryboardSheetPreviewImageVersion,
  indexFromNewest: number
): string {
  const labels: Record<StoryboardSheetPreviewImageVersionSource, string> = {
    generated: '生成',
    uploaded: '上传',
    regenerate: '重生成',
  };
  return `v${indexFromNewest + 1} ${labels[version.source] || '历史'}`;
}

async function snapshotSheetPreviewImageVersion(
  ref: SheetPreviewImageRef,
  previewId: string,
  source: StoryboardSheetPreviewImageVersionSource,
  opts: {
    assetId: string;
    companionBaseUrl: string;
    companionProjectId: string;
    resolveDataUrl: () => Promise<{ ok: true; dataUrl: string } | { ok: false }>;
  }
): Promise<StoryboardSheetPreviewImageVersion | null> {
  const hasRef =
    String(ref.imageDataUrl || '').trim() ||
    String(ref.imageCompanionKey || '').trim() ||
    String(ref.imageIdbKey || '').trim();
  if (!hasRef) return null;

  const version: StoryboardSheetPreviewImageVersion = {
    id: newSheetPreviewVersionId(),
    createdAt: Date.now(),
    source,
    imageCompanionKey: String(ref.imageCompanionKey || '').trim() || undefined,
    imageIdbKey: String(ref.imageIdbKey || '').trim() || undefined,
  };

  const base = String(opts.companionBaseUrl || '').trim();
  const pid = String(opts.companionProjectId || '').trim();
  if (base && pid) {
    const resolved = await opts.resolveDataUrl();
    if (resolved.ok) {
      let dataUrl = resolved.dataUrl;
      try {
        dataUrl = await compressStoryboardFrameDataUrl(dataUrl);
      } catch {
        /* keep raw */
      }
      const histKey = storyboardSheetPreviewHistoryCompanionKey(previewId, version.id);
      const put = await putWorkflowResultImageToCompanion(
        base,
        pid,
        opts.assetId,
        histKey,
        dataUrl
      );
      if (put.ok) {
        version.imageCompanionKey = put.key;
        version.imageIdbKey = undefined;
        version.imageDataUrl = undefined;
        return version;
      }
    }
  }

  const inline = String(ref.imageDataUrl || '').trim();
  if (inline) {
    try {
      version.imageDataUrl = await compressStoryboardFrameDataUrl(inline);
    } catch {
      version.imageDataUrl = inline;
    }
    version.imageCompanionKey = undefined;
    version.imageIdbKey = undefined;
    return version;
  }

  if (version.imageCompanionKey || version.imageIdbKey) {
    version.imageDataUrl = undefined;
    return version;
  }

  return null;
}

export async function appendSheetPreviewImageHistory(
  item: StoryboardSheetPreviewItem,
  source: StoryboardSheetPreviewImageVersionSource,
  opts: {
    assetId: string;
    companionBaseUrl: string;
    companionProjectId: string;
  }
): Promise<StoryboardSheetPreviewImageVersion[]> {
  const prev = trimSheetPreviewImageHistory(item.imageHistory || []);
  const snapshot = await snapshotSheetPreviewImageVersion(
    item,
    item.id,
    source,
    {
      ...opts,
      resolveDataUrl: async () => {
        const { resolveStoryboardSheetPreviewDataUrl } = await import('./storyboardSheetPreview');
        return resolveStoryboardSheetPreviewDataUrl(
          item,
          opts.assetId,
          opts.companionBaseUrl,
          opts.companionProjectId
        );
      },
    }
  );
  if (!snapshot) return prev;
  if (prev[0] && sheetPreviewImageRefsEqual(prev[0], snapshot)) return prev;
  return trimSheetPreviewImageHistory([snapshot, ...prev]);
}

export async function hydrateSheetPreviewImageVersion(
  version: StoryboardSheetPreviewImageVersion,
  assetId: string,
  previewId: string,
  companionBaseUrl: string,
  companionProjectId: string
): Promise<StoryboardSheetPreviewImageVersion> {
  if (String(version.imageDataUrl || '').trim()) return version;

  const companionKey = String(version.imageCompanionKey || '').trim();
  const base = String(companionBaseUrl || '').trim();
  const pid = String(companionProjectId || '').trim();
  if (companionKey && base && pid) {
    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, companionKey);
    if (got.ok) {
      return { ...version, imageDataUrl: got.objectUrl };
    }
  }

  const idbKey = String(version.imageIdbKey || '').trim();
  if (idbKey) {
    const blobPreviewId = idbKey.split('::').pop() || previewId;
    const blob = await loadStoryboardSheetPreviewBlobAsObjectUrl(assetId, blobPreviewId);
    if (blob) return { ...version, imageDataUrl: blob };
  }

  return version;
}

export async function activateSheetPreviewHistoryVersion(
  item: StoryboardSheetPreviewItem,
  versionId: string,
  opts: {
    assetId: string;
    companionBaseUrl: string;
    companionProjectId: string;
  }
): Promise<StoryboardSheetPreviewItem> {
  const history = trimSheetPreviewImageHistory(item.imageHistory || []);
  const index = history.findIndex((ver) => ver.id === versionId);
  if (index < 0) return item;

  const selected = history[index]!;
  const rest = history.filter((ver) => ver.id !== versionId);

  const archived = await snapshotSheetPreviewImageVersion(
    item,
    item.id,
    item.source === 'uploaded' ? 'uploaded' : 'generated',
    {
      ...opts,
      resolveDataUrl: async () => {
        const { resolveStoryboardSheetPreviewDataUrl } = await import('./storyboardSheetPreview');
        return resolveStoryboardSheetPreviewDataUrl(
          item,
          opts.assetId,
          opts.companionBaseUrl,
          opts.companionProjectId
        );
      },
    }
  );

  let nextHistory = rest;
  if (archived && !rest.some((ver) => sheetPreviewImageRefsEqual(ver, archived))) {
    nextHistory = trimSheetPreviewImageHistory([archived, ...rest]);
  }

  const hydrated = await hydrateSheetPreviewImageVersion(
    selected,
    opts.assetId,
    item.id,
    opts.companionBaseUrl,
    opts.companionProjectId
  );

  return {
    ...item,
    imageDataUrl: String(hydrated.imageDataUrl || '').trim(),
    imageCompanionKey: hydrated.imageCompanionKey,
    imageIdbKey: hydrated.imageIdbKey,
    imageHistory: nextHistory,
    matchedCount: 0,
  };
}

export async function replaceSheetPreviewActiveImage(
  item: StoryboardSheetPreviewItem,
  dataUrl: string,
  source: StoryboardSheetPreviewImageVersionSource,
  opts: {
    assetId: string;
    companionBaseUrl: string;
    companionProjectId: string;
  }
): Promise<StoryboardSheetPreviewItem> {
  const nextHistory = await appendSheetPreviewImageHistory(
    item,
    item.source === 'uploaded' ? 'uploaded' : 'generated',
    opts
  );
  let imageDataUrl = dataUrl;
  try {
    imageDataUrl = await compressStoryboardFrameDataUrl(dataUrl);
  } catch {
    /* keep raw */
  }

  const base = String(opts.companionBaseUrl || '').trim();
  const pid = String(opts.companionProjectId || '').trim();
  if (base && pid) {
    const put = await putWorkflowResultImageToCompanion(
      base,
      pid,
      opts.assetId,
      storyboardSheetPreviewCompanionResultKey(item.id),
      imageDataUrl
    );
    if (put.ok) {
      const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, put.key);
      return {
        ...item,
        imageDataUrl: got.ok ? got.objectUrl : imageDataUrl,
        imageCompanionKey: put.key,
        imageIdbKey: undefined,
        imageHistory: nextHistory,
        matchedCount: 0,
        genStatus: 'done',
        genError: undefined,
      };
    }
  }

  const idbOk = await saveStoryboardSheetPreviewBlob(opts.assetId, item.id, imageDataUrl);
  if (idbOk) {
    const objectUrl = await loadStoryboardSheetPreviewBlobAsObjectUrl(opts.assetId, item.id);
    return {
      ...item,
      imageDataUrl: objectUrl || imageDataUrl,
      imageCompanionKey: undefined,
      imageIdbKey: storyboardSheetPreviewBlobIdbKey(opts.assetId, item.id),
      imageHistory: nextHistory,
      matchedCount: 0,
      genStatus: 'done',
      genError: undefined,
    };
  }

  return {
    ...item,
    imageDataUrl,
    imageCompanionKey: undefined,
    imageIdbKey: undefined,
    imageHistory: nextHistory,
    matchedCount: 0,
    genStatus: 'done',
    genError: undefined,
  };
}

export async function cleanupSheetPreviewHistoryAssets(
  previewId: string,
  history: StoryboardSheetPreviewImageVersion[] | undefined,
  opts: {
    assetId: string;
    companionBaseUrl: string;
    companionProjectId: string;
  }
): Promise<void> {
  if (!history?.length) return;
  const base = String(opts.companionBaseUrl || '').trim();
  const pid = String(opts.companionProjectId || '').trim();
  const { deleteCompanionAsset } = await import('./companionClient/storage');

  for (const ver of history) {
    const url = String(ver.imageDataUrl || '').trim();
    if (url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    const companionKey = String(ver.imageCompanionKey || '').trim();
    if (companionKey && base && pid) {
      try {
        await deleteCompanionAsset(base, pid, companionKey);
      } catch {
        /* ignore */
      }
    }
    const idbKey = String(ver.imageIdbKey || '').trim();
    if (idbKey) {
      const verPreviewId = idbKey.split('::').pop() || previewId;
      await deleteStoryboardSheetPreviewBlob(opts.assetId, verPreviewId);
    }
  }
}
