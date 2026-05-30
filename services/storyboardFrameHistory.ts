import type {
  StoryboardFrameImageVersion,
  StoryboardFrameVersionSource,
  StoryboardTableRow,
} from '../types';
import { compressStoryboardFrameDataUrl } from '../components/storyboard/storyboardFrameImage';
import {
  persistStoryboardFrameImage,
  storyboardFrameCompanionResultKey,
  type StoryboardFrameRowPatch,
} from './storyboardFrameCompanion';
import {
  resolveStoryboardFrameDisplaySrc,
  storyboardRowHasFrameRef,
} from './storyboardFrameImageUrl';
import { resolveStoryboardRowFrameDataUrl } from './storyboardTableRedraw';
import { putWorkflowResultImageToCompanion } from './workflowCompanionAssets';

export const STORYBOARD_FRAME_HISTORY_LIMIT = 12;

export function storyboardFrameHistoryCompanionKey(rowId: string, versionId: string): string {
  return `${storyboardFrameCompanionResultKey(rowId)}--hist--${versionId}`;
}

function newStoryboardFrameVersionId(): string {
  return `sfv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function storyboardFrameRefsEqual(
  a: Pick<
    StoryboardTableRow,
    'frameImage' | 'frameImageObjectKey' | 'frameImageCompanionKey'
  >,
  b: Pick<StoryboardTableRow, 'frameImage' | 'frameImageObjectKey' | 'frameImageCompanionKey'>
): boolean {
  return (
    String(a.frameImage || '').trim() === String(b.frameImage || '').trim() &&
    String(a.frameImageObjectKey || '').trim() === String(b.frameImageObjectKey || '').trim() &&
    String(a.frameImageCompanionKey || '').trim() === String(b.frameImageCompanionKey || '').trim()
  );
}

export function normalizeStoryboardFrameHistory(raw: unknown): StoryboardFrameImageVersion[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryboardFrameImageVersion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Partial<StoryboardFrameImageVersion>;
    const id = String(row.id || '').trim();
    if (!id) continue;
    const source = row.source;
    const validSource: StoryboardFrameVersionSource =
      source === 'upload' ||
      source === 'redraw' ||
      source === 'sheet_split' ||
      source === 'paste' ||
      source === 'restore' ||
      source === 'clear'
        ? source
        : 'upload';
    const hasRef =
      String(row.frameImage || '').trim() ||
      String(row.frameImageObjectKey || '').trim() ||
      String(row.frameImageCompanionKey || '').trim();
    if (!hasRef) continue;
    out.push({
      id,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
      source: validSource,
      frameImage: String(row.frameImage || '').trim() || undefined,
      frameImageObjectKey: String(row.frameImageObjectKey || '').trim() || undefined,
      frameImageCompanionKey: String(row.frameImageCompanionKey || '').trim() || undefined,
    });
  }
  return out.slice(0, STORYBOARD_FRAME_HISTORY_LIMIT);
}

export function trimStoryboardFrameHistory(
  history: StoryboardFrameImageVersion[]
): StoryboardFrameImageVersion[] {
  return history.slice(0, STORYBOARD_FRAME_HISTORY_LIMIT);
}

export function storyboardFrameHistorySignature(history: StoryboardFrameImageVersion[] | undefined): string {
  if (!history?.length) return '';
  return history
    .map(
      (item) =>
        `${item.id}:${item.source}:${item.frameImageCompanionKey || ''}:${item.frameImageObjectKey || ''}:${item.frameImage ? '1' : '0'}`
    )
    .join('|');
}

export function resolveStoryboardFrameVersionDisplaySrc(
  version: Pick<
    StoryboardFrameImageVersion,
    'frameImage' | 'frameImageObjectKey' | 'frameImageCompanionKey'
  >
): string {
  return resolveStoryboardFrameDisplaySrc(version.frameImage, version.frameImageObjectKey) || '';
}

export function storyboardFrameVersionLabel(
  version: StoryboardFrameImageVersion,
  indexFromNewest: number
): string {
  const labels: Record<StoryboardFrameVersionSource, string> = {
    upload: '上传',
    redraw: '重绘',
    sheet_split: '切分',
    paste: '粘贴',
    restore: '回退前',
    clear: '清除前',
  };
  return `v${indexFromNewest + 1} ${labels[version.source] || '历史'}`;
}

async function snapshotStoryboardFrameVersion(
  row: StoryboardTableRow,
  source: StoryboardFrameVersionSource,
  opts: {
    assetId: string;
    companionBaseUrl: string;
    companionProjectId: string;
  }
): Promise<StoryboardFrameImageVersion | null> {
  if (!storyboardRowHasFrameRef(row)) return null;

  const version: StoryboardFrameImageVersion = {
    id: newStoryboardFrameVersionId(),
    createdAt: Date.now(),
    source,
    frameImageObjectKey: String(row.frameImageObjectKey || '').trim() || undefined,
    frameImageCompanionKey: String(row.frameImageCompanionKey || '').trim() || undefined,
  };

  const base = String(opts.companionBaseUrl || '').trim();
  const pid = String(opts.companionProjectId || '').trim();
  if (base && pid) {
    const resolved = await resolveStoryboardRowFrameDataUrl(row, base, pid);
    if (resolved.ok) {
      let dataUrl = resolved.dataUrl;
      try {
        dataUrl = await compressStoryboardFrameDataUrl(dataUrl);
      } catch {
        /* keep raw */
      }
      const histKey = storyboardFrameHistoryCompanionKey(row.id, version.id);
      const put = await putWorkflowResultImageToCompanion(
        base,
        pid,
        opts.assetId,
        histKey,
        dataUrl
      );
      if (put.ok) {
        version.frameImageCompanionKey = put.key;
        version.frameImageObjectKey = undefined;
        try {
          version.frameImage = await compressStoryboardFrameDataUrl(dataUrl);
        } catch {
          version.frameImage = undefined;
        }
        return version;
      }
    }
  }

  if (version.frameImageObjectKey) {
    version.frameImage = undefined;
    return version;
  }

  const inline = String(row.frameImage || '').trim();
  if (!inline) return null;
  try {
    version.frameImage = await compressStoryboardFrameDataUrl(inline);
  } catch {
    version.frameImage = inline;
  }
  version.frameImageObjectKey = undefined;
  version.frameImageCompanionKey = undefined;
  return version;
}

export async function appendStoryboardFrameHistory(
  row: StoryboardTableRow,
  source: StoryboardFrameVersionSource,
  opts: {
    assetId: string;
    companionBaseUrl: string;
    companionProjectId: string;
  }
): Promise<StoryboardFrameImageVersion[]> {
  const prev = trimStoryboardFrameHistory(row.frameImageHistory || []);
  const snapshot = await snapshotStoryboardFrameVersion(row, source, opts);
  if (!snapshot) return prev;
  if (prev[0] && storyboardFrameRefsEqual(prev[0], snapshot)) return prev;
  return trimStoryboardFrameHistory([snapshot, ...prev]);
}

export type ReplaceStoryboardRowFrameOpts = {
  row: StoryboardTableRow;
  dataUrl: string;
  assetId: string;
  companionBaseUrl: string;
  companionProjectId: string;
  source: StoryboardFrameVersionSource;
};

/** 归档当前分镜图并写入新图（重绘/上传/切分回填共用） */
export async function replaceStoryboardRowFrame(
  opts: ReplaceStoryboardRowFrameOpts
): Promise<Partial<StoryboardTableRow>> {
  const history = await appendStoryboardFrameHistory(opts.row, opts.source, {
    assetId: opts.assetId,
    companionBaseUrl: opts.companionBaseUrl,
    companionProjectId: opts.companionProjectId,
  });
  const framePatch: StoryboardFrameRowPatch = await persistStoryboardFrameImage({
    dataUrl: opts.dataUrl,
    assetId: opts.assetId,
    rowId: opts.row.id,
    companionBaseUrl: opts.companionBaseUrl,
    companionProjectId: opts.companionProjectId,
  });
  return { ...framePatch, frameImageHistory: history };
}

export async function restoreStoryboardRowFrameVersion(
  row: StoryboardTableRow,
  versionId: string,
  opts: {
    assetId: string;
    companionBaseUrl: string;
    companionProjectId: string;
  }
): Promise<Partial<StoryboardTableRow> | null> {
  const history = row.frameImageHistory || [];
  const target = history.find((item) => item.id === versionId);
  if (!target) return null;

  const nextHistory = await appendStoryboardFrameHistory(row, 'restore', opts);
  const filtered = trimStoryboardFrameHistory(nextHistory.filter((item) => item.id !== versionId));

  let framePatch: StoryboardFrameRowPatch = {
    frameImage: target.frameImage,
    frameImageObjectKey: target.frameImageObjectKey,
    frameImageCompanionKey: target.frameImageCompanionKey,
  };

  if (target.frameImageCompanionKey && opts.companionBaseUrl && opts.companionProjectId) {
    const resolved = await resolveStoryboardRowFrameDataUrl(
      {
        ...row,
        frameImage: undefined,
        frameImageObjectKey: undefined,
        frameImageCompanionKey: target.frameImageCompanionKey,
      },
      opts.companionBaseUrl,
      opts.companionProjectId
    );
    if (resolved.ok) {
      framePatch = await persistStoryboardFrameImage({
        dataUrl: resolved.dataUrl,
        assetId: opts.assetId,
        rowId: row.id,
        companionBaseUrl: opts.companionBaseUrl,
        companionProjectId: opts.companionProjectId,
      });
    }
  }

  return {
    ...framePatch,
    frameImageHistory: filtered,
  };
}

export async function clearStoryboardRowFrameWithHistory(
  row: StoryboardTableRow,
  opts: {
    assetId: string;
    companionBaseUrl: string;
    companionProjectId: string;
  }
): Promise<Partial<StoryboardTableRow>> {
  const history = await appendStoryboardFrameHistory(row, 'clear', opts);
  return {
    frameImage: undefined,
    frameImageObjectKey: undefined,
    frameImageCompanionKey: undefined,
    frameImageHistory: history,
  };
}
