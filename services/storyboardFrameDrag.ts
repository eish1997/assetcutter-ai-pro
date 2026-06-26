import { collectStoryboardFrameImageFiles } from './storyboardTableFrameImport';

/** 分镜表资产窗拖出；与 `collectStoryboardFrameImageInputs` 成对使用 */
export const DT_AC_STORYBOARD_FRAME_ASSET = 'application/x-ac-storyboard-frame-asset';

export type StoryboardFrameAssetDragPayload = {
  displaySrc: string;
  rowId: string;
  shotLabel: string;
  createdAt: number;
};

export function storyboardFrameImageDropAllowed(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types);
  return types.includes('Files') || types.includes(DT_AC_STORYBOARD_FRAME_ASSET);
}

export function writeStoryboardFrameAssetDragData(
  dataTransfer: DataTransfer,
  payload: StoryboardFrameAssetDragPayload
): void {
  dataTransfer.setData(DT_AC_STORYBOARD_FRAME_ASSET, JSON.stringify(payload));
  dataTransfer.setData('text/plain', payload.displaySrc);
  dataTransfer.effectAllowed = 'copy';
}

export async function storyboardFrameAssetPayloadToFile(
  payload: StoryboardFrameAssetDragPayload
): Promise<File | null> {
  const src = String(payload.displaySrc || '').trim();
  if (!src) return null;
  const safeName = `storyboard-${payload.shotLabel || payload.rowId}`.replace(/[^\w.-]+/g, '_');
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    return new File([blob], `${safeName}.png`, { type: blob.type || 'image/png' });
  } catch {
    return null;
  }
}

export async function collectStoryboardFrameImageInputs(
  source: DataTransfer | null | undefined
): Promise<File[]> {
  const files = collectStoryboardFrameImageFiles(source);
  if (files.length) return files;
  if (!source) return [];
  const raw = source.getData(DT_AC_STORYBOARD_FRAME_ASSET);
  if (!raw) return [];
  try {
    const payload = JSON.parse(raw) as StoryboardFrameAssetDragPayload;
    const file = await storyboardFrameAssetPayloadToFile(payload);
    return file ? [file] : [];
  } catch {
    return [];
  }
}

/** 画板/行编辑区拖入：优先生图历史 payload，且只取第一张图 */
export async function collectStoryboardFrameImageInputForDrop(
  source: DataTransfer | null | undefined
): Promise<File | null> {
  if (!source) return null;
  const raw = source.getData(DT_AC_STORYBOARD_FRAME_ASSET);
  if (raw) {
    try {
      const payload = JSON.parse(raw) as StoryboardFrameAssetDragPayload;
      const file = await storyboardFrameAssetPayloadToFile(payload);
      if (file) return file;
    } catch {
      /* fall through to Files */
    }
  }
  const files = collectStoryboardFrameImageFiles(source);
  return files[0] ?? null;
}
