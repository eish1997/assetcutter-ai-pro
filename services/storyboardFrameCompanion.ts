import {
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  putWorkflowResultImageToCompanion,
} from './workflowCompanionAssets';
import type { StoryboardTableRow } from '../types';

export function storyboardFrameCompanionResultKey(rowId: string): string {
  return `storyboard-frame-${rowId}`;
}

export type PersistStoryboardFrameOpts = {
  dataUrl: string;
  assetId: string;
  rowId: string;
  companionBaseUrl: string;
  companionProjectId: string;
};

/** 分镜图落本地伴侣，成功后可清空行内 data URL 以减轻 IDB / 同步体积 */
export async function persistStoryboardFrameToCompanion(
  opts: PersistStoryboardFrameOpts
): Promise<{ ok: true; companionKey: string } | { ok: false }> {
  const base = String(opts.companionBaseUrl || '').trim();
  const pid = String(opts.companionProjectId || '').trim();
  if (!base || !pid) return { ok: false };

  const put = await putWorkflowResultImageToCompanion(
    base,
    pid,
    opts.assetId,
    storyboardFrameCompanionResultKey(opts.rowId),
    opts.dataUrl
  );
  if (!put.ok) return { ok: false };
  return { ok: true, companionKey: put.key };
}

export type StoryboardFrameRowPatch = Pick<
  StoryboardTableRow,
  'frameImage' | 'frameImageObjectKey' | 'frameImageCompanionKey'
>;

/** 落伴侣并立即拉 blob 供 UI 显示；失败时保留 data URL */
export async function persistStoryboardFrameImage(
  opts: PersistStoryboardFrameOpts
): Promise<StoryboardFrameRowPatch> {
  const dataUrl = opts.dataUrl;
  const persisted = await persistStoryboardFrameToCompanion(opts);
  if (!persisted.ok) {
    return {
      frameImage: dataUrl,
      frameImageObjectKey: undefined,
      frameImageCompanionKey: undefined,
    };
  }
  const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(
    opts.companionBaseUrl,
    opts.companionProjectId,
    persisted.companionKey
  );
  if (got.ok) {
    return {
      frameImage: got.objectUrl,
      frameImageObjectKey: undefined,
      frameImageCompanionKey: persisted.companionKey,
    };
  }
  return {
    frameImage: dataUrl,
    frameImageObjectKey: undefined,
    frameImageCompanionKey: persisted.companionKey,
  };
}

export function storyboardRowNeedsCompanionFrameHydrate(row: StoryboardTableRow): boolean {
  if (String(row.frameImageObjectKey || '').trim()) return false;
  const key = String(row.frameImageCompanionKey || '').trim();
  if (!key) return false;
  const img = String(row.frameImage || '').trim();
  if (!img) return true;
  return !img.startsWith('data:') && !/^blob:/i.test(img) && !/^https?:\/\//i.test(img);
}

export function storyboardTableHasCompanionFrameHydrateGaps(
  rows: StoryboardTableRow[] | undefined
): boolean {
  if (!rows?.length) return false;
  return rows.some(storyboardRowNeedsCompanionFrameHydrate);
}
