import type { BoundingBox, StoryboardTableRow } from '../types';
import { storyboardRowHasFrameRef } from './storyboardFrameImageUrl';
import {
  buildUniformSheetGridBoxes,
  clampStoryboardSheetSplitBox,
  isCollapsedStoryboardSheetVisionDetect,
  labelStoryboardLayoutGridBoxes,
  suggestStoryboardSheetLayoutGrid,
  type StoryboardSheetLayoutGrid,
} from './storyboardSheetVisionSplit';

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

/** 拖入/落到指定镜头：只配该镜，不沿表顺序批量分配 */
export function planStoryboardFrameImportAssignmentForTargetRow(
  rows: StoryboardTableRow[],
  targetRowId: string
): { assignment: StoryboardFrameImportAssignment | null; skippedLocked: boolean } {
  const row = rows.find((entry) => entry.id === targetRowId);
  if (!row) return { assignment: null, skippedLocked: false };
  if (row.locked) return { assignment: null, skippedLocked: true };
  return { assignment: { rowId: targetRowId, fileIndex: 0 }, skippedLocked: false };
}

/** 多选拖入切分：按表物理顺序取选中且未通过镜头 */
export function resolveStoryboardFrameDropSplitTaskRows(
  rows: StoryboardTableRow[],
  selectedRowIds: string[]
): StoryboardTableRow[] {
  const idSet = new Set(selectedRowIds);
  return rows.filter((row) => idSet.has(row.id) && !row.locked);
}

/** 落点属于当前选中集且选中 ≥2 镜 → 走统一切分框；格数以图为准，单选走裁切弹窗 */
export function shouldStoryboardFrameDropUseSheetSplit(
  targetRowId: string,
  selectedRowIds: string[] | undefined
): boolean {
  if (!selectedRowIds || selectedRowIds.length <= 1) return false;
  return selectedRowIds.includes(targetRowId);
}

export function buildStoryboardFrameDropSplitExpectedShotNos(
  taskRows: StoryboardTableRow[]
): string[] {
  return taskRows
    .map((row) => row.shotNo?.trim())
    .filter((shotNo): shotNo is string => Boolean(shotNo));
}

export type StoryboardFrameDropSplitPlan = {
  /** 实际回填的镜头（选中集内前 N 镜，N = min(图格数, 选中数)） */
  assignRows: StoryboardTableRow[];
  /** 图内分镜格数（切分框数量） */
  panelCount: number;
  layoutGrid: StoryboardSheetLayoutGrid;
  expectedShotNos: string[];
  selectionCount: number;
  mismatchMessage?: string;
};

/** 以图内格数为准规划切分，不盲信选中镜数 */
export function planStoryboardFrameDropSplitScope(
  selectedTaskRows: StoryboardTableRow[],
  imagePanelCount: number,
  layoutGrid?: StoryboardSheetLayoutGrid
): StoryboardFrameDropSplitPlan {
  const selectionCount = selectedTaskRows.length;
  const panelCount = Math.max(1, Math.min(Math.round(imagePanelCount), 40));
  const assignRows = selectedTaskRows.slice(0, Math.min(panelCount, selectionCount));
  const grid = layoutGrid ?? suggestStoryboardSheetLayoutGrid(panelCount);
  const expectedShotNos = buildStoryboardFrameDropSplitExpectedShotNos(assignRows);

  let mismatchMessage: string | undefined;
  if (selectionCount > panelCount) {
    mismatchMessage = `选中 ${selectionCount} 镜，图内约 ${panelCount} 格，按顺序配前 ${assignRows.length} 镜`;
  } else if (panelCount > selectionCount) {
    mismatchMessage = `选中 ${selectionCount} 镜，图内约 ${panelCount} 格，仅前 ${assignRows.length} 镜可回填`;
  }

  return {
    assignRows,
    panelCount,
    layoutGrid: grid,
    expectedShotNos,
    selectionCount,
    mismatchMessage,
  };
}

export function buildStoryboardFrameDropSplitFallbackBoxes(
  panelCount: number,
  assignRows: StoryboardTableRow[]
): BoundingBox[] {
  return labelStoryboardLayoutGridBoxes(
    buildUniformSheetGridBoxes(panelCount),
    buildStoryboardFrameDropSplitExpectedShotNos(assignRows)
  );
}

export function normalizeStoryboardFrameDropSplitBoxes(
  detected: BoundingBox[],
  panelCount: number,
  assignRows: StoryboardTableRow[]
): BoundingBox[] {
  const expectedShotNos = buildStoryboardFrameDropSplitExpectedShotNos(assignRows);
  const fallback = buildStoryboardFrameDropSplitFallbackBoxes(panelCount, assignRows);
  if (isCollapsedStoryboardSheetVisionDetect(detected) || !detected.length) {
    return fallback;
  }
  const clamped = detected.map((box) => clampStoryboardSheetSplitBox(box));
  if (clamped.length < panelCount) {
    return fallback;
  }
  return labelStoryboardLayoutGridBoxes(clamped.slice(0, panelCount), expectedShotNos);
}
