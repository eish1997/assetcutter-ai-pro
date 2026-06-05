import type { StoryboardTableRow } from '../types';
import { storyboardRowHasFrameRef } from './storyboardFrameImageUrl';

export const STORYBOARD_FRAME_IMPORT_MAX_FILES = 50;

export function sortStoryboardFrameImageFiles(files: File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );
}

export function collectStoryboardFrameImageFiles(
  source: FileList | DataTransfer | File[] | null | undefined,
  max = STORYBOARD_FRAME_IMPORT_MAX_FILES
): File[] {
  if (!source) return [];
  let raw: File[] = [];
  if (Array.isArray(source)) {
    raw = source;
  } else if ('files' in source && source.files) {
    raw = Array.from(source.files);
  } else {
    raw = Array.from(source as ArrayLike<File>);
  }
  const images = raw.filter((file) => file.type.startsWith('image/')).slice(0, max);
  return sortStoryboardFrameImageFiles(images);
}

/** 批量配图起始镜：指定镜优先，否则首个缺配图镜，再否则第 1 镜 */
export function resolveStoryboardFrameImportStartIndex(
  rows: StoryboardTableRow[],
  startRowId: string | null | undefined
): number {
  if (startRowId) {
    const idx = rows.findIndex((row) => row.id === startRowId);
    if (idx >= 0) return idx;
  }
  const firstEmpty = rows.findIndex((row) => !storyboardRowHasFrameRef(row));
  return firstEmpty >= 0 ? firstEmpty : 0;
}

export type StoryboardFrameImportAssignment = {
  rowId: string;
  fileIndex: number;
};

export function planStoryboardFrameImportAssignments(
  rows: StoryboardTableRow[],
  startRowId: string | null | undefined,
  fileCount: number
): { assignments: StoryboardFrameImportAssignment[]; skippedLocked: number; unusedFiles: number } {
  if (fileCount <= 0 || rows.length === 0) {
    return { assignments: [], skippedLocked: 0, unusedFiles: fileCount };
  }

  const from = resolveStoryboardFrameImportStartIndex(rows, startRowId);
  const assignments: StoryboardFrameImportAssignment[] = [];
  let skippedLocked = 0;
  let fileIndex = 0;

  for (let i = from; i < rows.length && fileIndex < fileCount; i += 1) {
    const row = rows[i]!;
    if (row.locked) {
      skippedLocked += 1;
      continue;
    }
    assignments.push({ rowId: row.id, fileIndex });
    fileIndex += 1;
  }

  return {
    assignments,
    skippedLocked,
    unusedFiles: Math.max(0, fileCount - assignments.length),
  };
}
