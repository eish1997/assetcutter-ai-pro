export type WorkflowJustifiedLayoutInput = {
  id: string;
  /** 宽 / 高 */
  aspectRatio: number;
};

export type WorkflowJustifiedLayoutBox = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type WorkflowJustifiedLayoutResult = {
  boxes: WorkflowJustifiedLayoutBox[];
  totalHeight: number;
  containerWidth: number;
};

export type WorkflowJustifiedLayoutOptions = {
  gap?: number;
  /** 行高达到或低于此值时换行（Flickr / Google Photos 式 justified） */
  targetRowHeight?: number;
  /** 末行或单行时的最大行高，避免单张超宽图撑满过高 */
  maxRowHeight?: number;
};

export const WORKFLOW_ASSET_GRID_GAP_PX = 8;

/** 顶栏「列数」映射为 justified 目标行高：列越多行越矮 */
export function workflowJustifiedTargetRowHeight(columnCount: number): number {
  const cols = Math.max(2, Math.min(6, Math.round(columnCount)));
  return Math.round(520 / cols);
}

function rowHeightForAspectSum(
  aspectSum: number,
  count: number,
  containerWidth: number,
  gap: number
): number {
  if (!(aspectSum > 0) || count <= 0) return 0;
  const gaps = Math.max(0, count - 1) * gap;
  return (containerWidth - gaps) / aspectSum;
}

function commitRow(
  row: WorkflowJustifiedLayoutInput[],
  containerWidth: number,
  gap: number,
  maxRowHeight: number
): { height: number; items: Array<{ id: string; width: number }> } {
  const n = row.length;
  const aspectSum = row.reduce((s, item) => s + item.aspectRatio, 0);
  let height = rowHeightForAspectSum(aspectSum, n, containerWidth, gap);
  if (!(height > 0)) height = maxRowHeight;
  height = Math.min(height, maxRowHeight);
  return {
    height,
    items: row.map((item) => ({
      id: item.id,
      width: item.aspectRatio * height,
    })),
  };
}

/**
 * 横向智能排列（justified layout）：每行内卡片等高，宽度按宽高比分配，行宽铺满容器。
 */
export function computeWorkflowJustifiedLayout(
  items: WorkflowJustifiedLayoutInput[],
  containerWidth: number,
  options: WorkflowJustifiedLayoutOptions = {}
): WorkflowJustifiedLayoutResult {
  const gap = options.gap ?? WORKFLOW_ASSET_GRID_GAP_PX;
  const targetRowHeight = options.targetRowHeight ?? 200;
  const maxRowHeight = options.maxRowHeight ?? Math.max(targetRowHeight * 1.85, targetRowHeight + 80);

  if (!(containerWidth > 0) || items.length === 0) {
    return { boxes: [], totalHeight: 0, containerWidth: Math.max(0, containerWidth) };
  }

  type RowDraft = ReturnType<typeof commitRow>;
  const rows: RowDraft[] = [];
  let currentRow: WorkflowJustifiedLayoutInput[] = [];
  let aspectSum = 0;

  for (const item of items) {
    const ar = item.aspectRatio > 0 ? item.aspectRatio : 1;
    currentRow.push({ ...item, aspectRatio: ar });
    aspectSum += ar;
    const h = rowHeightForAspectSum(aspectSum, currentRow.length, containerWidth, gap);
    if (h > 0 && h <= targetRowHeight) {
      rows.push(commitRow(currentRow, containerWidth, gap, maxRowHeight));
      currentRow = [];
      aspectSum = 0;
    }
  }

  if (currentRow.length > 0) {
    rows.push(commitRow(currentRow, containerWidth, gap, maxRowHeight));
  }

  const boxes: WorkflowJustifiedLayoutBox[] = [];
  let top = 0;
  for (const row of rows) {
    let left = 0;
    for (const item of row.items) {
      boxes.push({
        id: item.id,
        left,
        top,
        width: item.width,
        height: row.height,
      });
      left += item.width + gap;
    }
    top += row.height + gap;
  }

  const totalHeight = rows.length > 0 ? top - gap : 0;
  return { boxes, totalHeight, containerWidth };
}
