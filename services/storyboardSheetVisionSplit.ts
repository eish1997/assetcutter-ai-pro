import type { BoundingBox, StoryboardTableRow } from '../types';
import { createStoryboardTableRow } from './storyboardTableAsset';
import { normalizeStoryboardShotNoInput } from './storyboardTableParse';
import { computeStoryboardMosaicGrid } from './storyboardFrameStripMerge';
import { cropBoxes } from './imageCrop';
import { detectObjectsInImage } from './unifiedAiGateway';
import { DEFAULT_MODEL_TEXT } from './modelRegistry/constants';

export const STORYBOARD_SHEET_VISION_TIMEOUT_MS = 90_000;

export type StoryboardSheetVisionMatch = {
  rowId: string;
  shotNo: string;
  label: string;
  image: string;
  box: BoundingBox;
};

export type StoryboardSheetVisionSplitResult = {
  matches: StoryboardSheetVisionMatch[];
  unmatchedLabels: string[];
  warn?: string;
  createdRows?: StoryboardTableRow[];
};

export function normalizeShotNoToken(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^(镜头号|镜号)\s*[：:]\s*/i, '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '');
}

export function extractShotNoToken(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  const explicit = text.match(/\b(?:SC\d+[_-]?)?S?\d{2,4}\b/i);
  if (explicit?.[0]) return normalizeShotNoToken(explicit[0]);
  const leadingDigits = text.match(/^(\d{1,4})/);
  if (leadingDigits?.[1]) return normalizeShotNoToken(leadingDigits[1]);
  return normalizeShotNoToken(text);
}

/** 镜号是否指向同一镜头（含 131 与 0131 等数值等价） */
export function storyboardShotNosMatch(a: string, b: string): boolean {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return false;
  if (left === right) return true;

  const tokenA = normalizeShotNoToken(left);
  const tokenB = normalizeShotNoToken(right);
  if (!tokenA || !tokenB) return false;
  if (tokenA === tokenB) return true;
  if (/^\d+$/.test(tokenA) && /^\d+$/.test(tokenB)) {
    return Number(tokenA) === Number(tokenB);
  }
  if (tokenA.endsWith(tokenB) || tokenB.endsWith(tokenA)) return true;
  return tokenA.includes(tokenB) || tokenB.includes(tokenA);
}

export function buildStoryboardSheetVisionPrompt(expectedShotNos: string[]): string {
  const expected = [...new Set(expectedShotNos.map((shot) => shot.trim()).filter(Boolean))];
  const expectedLine = expected.length
    ? `本图应包含下列镜号（label 必须与格内印刷镜号一致）：${expected.join('、')}。`
    : '';

  return `你是分镜表拼图切分助手。输入是一张包含多个分镜格的故事板拼图（contact sheet）。

任务分两步理解每一格：
1. 读取镜号：从该格顶部元数据条（如 SC01_SH001、景别、角度等）读取镜号，写入 label；
2. 框选画面：box_2d 只框住中间「草图/插画」区域，用于回填分镜图。

box_2d 必须排除（不要框进）：
- 顶部元数据文字条（镜号、景别、角度、运镜、时长等）；
- 底部说明文字条（画面描述、对白、旁白等）；
- 左右两侧的纯文字栏（若有）。

box_2d 应紧贴草图外轮廓，略留 1–2% 边距即可；不要把多格合并为一框。

常见版式：
- 竖格：上文字 / 中画面 / 下文字 → 只框中间画面；
- 横格：左文字 / 右草图 → 只框右侧草图。

label 规则：
- 读取每格镜号文字（如 S030、SC01_SH001），原样写入 label；
- 不要编造镜号；看不清的格可跳过；
- 同一镜号只保留一个框（取画面最完整的一格）。

${expectedLine}

返回 JSON 数组，每项含 id、label、box_2d。
box_2d 为 [ymin, xmin, ymax, xmax]，坐标归一化 0–1000。`;
}

export type ShrinkPanelVisualOptions = {
  topRatio?: number;
  bottomRatio?: number;
  leftRatio?: number;
  rightRatio?: number;
  minSpan?: number;
};

/** 从整格 box 裁掉常见文字条，只保留中间画面区（坐标 0–1000） */
export function shrinkStoryboardPanelBoxToVisualCore(
  box: BoundingBox,
  opts: ShrinkPanelVisualOptions = {}
): BoundingBox {
  const topRatio = opts.topRatio ?? 0.13;
  const bottomRatio = opts.bottomRatio ?? 0.21;
  const leftRatio = opts.leftRatio ?? 0;
  const rightRatio = opts.rightRatio ?? 0;
  const minSpan = opts.minSpan ?? 72;

  const w = box.xmax - box.xmin;
  const h = box.ymax - box.ymin;
  if (w <= 0 || h <= 0) return box;

  const landscapeInner = w > h * 1.12;
  const ymin = box.ymin + Math.round(h * (landscapeInner ? Math.min(topRatio, 0.08) : topRatio));
  const ymax = box.ymax - Math.round(h * (landscapeInner ? Math.min(bottomRatio, 0.08) : bottomRatio));
  const xmin =
    box.xmin + Math.round(w * (landscapeInner ? Math.max(leftRatio, 0.24) : leftRatio));
  const xmax = box.xmax - Math.round(w * rightRatio);

  if (ymax - ymin < minSpan || xmax - xmin < minSpan) return box;
  return { ...box, ymin, xmin, ymax, xmax };
}

/** 视觉框若仍含整格高度，再裁掉上下/左右文字区 */
export function mapStoryboardBoxesToVisualCrop(boxes: BoundingBox[]): BoundingBox[] {
  if (!boxes.length) return boxes;
  const heights = boxes.map((box) => box.ymax - box.ymin).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] ?? 0;

  return boxes.map((box) => {
    const h = box.ymax - box.ymin;
    const w = box.xmax - box.xmin;
    if (medianH > 0 && h < medianH * 0.72) return box;
    return shrinkStoryboardPanelBoxToVisualCore(box, {
      topRatio: w > h * 1.12 ? 0.06 : 0.13,
      bottomRatio: w > h * 1.12 ? 0.06 : 0.21,
      leftRatio: w > h * 1.12 ? 0.24 : 0,
    });
  });
}

export function matchVisionBoxToRow(
  box: BoundingBox,
  rows: StoryboardTableRow[]
): StoryboardTableRow | null {
  const labelCandidates = [box.label, extractShotNoToken(box.label)].filter(Boolean);
  if (!labelCandidates.length) return null;

  let best: StoryboardTableRow | null = null;
  let bestScore = -1;

  for (const row of rows) {
    const rowShot = row.shotNo?.trim() || '';
    if (!rowShot) continue;

    let score = -1;
    for (const candidate of labelCandidates) {
      if (storyboardShotNosMatch(candidate, rowShot)) {
        const tokenA = normalizeShotNoToken(candidate);
        const tokenB = normalizeShotNoToken(rowShot);
        if (candidate === rowShot || tokenA === tokenB) score = Math.max(score, 100);
        else if (/^\d+$/.test(tokenA) && /^\d+$/.test(tokenB) && Number(tokenA) === Number(tokenB)) {
          score = Math.max(score, 95);
        } else score = Math.max(score, 80);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  return bestScore >= 80 ? best : null;
}

function dedupeBoxesByLabel(boxes: BoundingBox[]): BoundingBox[] {
  const byLabel = new Map<string, BoundingBox>();
  for (const box of boxes) {
    const key = extractShotNoToken(box.label) || box.label.trim();
    if (!key) continue;
    const prev = byLabel.get(key);
    if (!prev) {
      byLabel.set(key, box);
      continue;
    }
    const prevArea = (prev.xmax - prev.xmin) * (prev.ymax - prev.ymin);
    const nextArea = (box.xmax - box.xmin) * (box.ymax - box.ymin);
    if (nextArea > prevArea) byLabel.set(key, box);
  }
  return [...byLabel.values()];
}

export async function detectStoryboardSheetPanels(
  dataUrl: string,
  expectedShotNos: string[],
  textModel = DEFAULT_MODEL_TEXT,
  options?: { timeoutMs?: number; customPrompt?: string }
): Promise<BoundingBox[]> {
  const prompt =
    options?.customPrompt?.trim() ||
    buildStoryboardSheetVisionPrompt(expectedShotNos);
  const boxes = await detectObjectsInImage(dataUrl, textModel, prompt, {
    timeoutMs: options?.timeoutMs ?? STORYBOARD_SHEET_VISION_TIMEOUT_MS,
  });
  return mapStoryboardBoxesToVisualCrop(dedupeBoxesByLabel(boxes));
}

export function visionLabelToShotNo(label: string): string {
  const text = String(label || '').trim();
  if (!text) return '';
  const stripped = text.replace(/^(镜头号|镜号)\s*[：:]\s*/i, '').trim();
  return normalizeStoryboardShotNoInput(stripped || extractShotNoToken(text));
}

/** 切分回填时只匹配本拼图镜号范围内的镜头，避免误填全表 */
export function filterStoryboardRowsByExpectedShots(
  rows: StoryboardTableRow[],
  expectedShotNos: string[]
): StoryboardTableRow[] {
  const normalizedExpected = expectedShotNos.map((shot) => shot.trim()).filter(Boolean);
  if (!normalizedExpected.length) return rows;

  const scoped = rows.filter((row) => {
    const shotNo = row.shotNo?.trim() || '';
    if (!shotNo) return false;
    return normalizedExpected.some((expected) => storyboardShotNosMatch(expected, shotNo));
  });

  return scoped.length ? scoped : rows;
}

export function isStoryboardShotNoInExpectedScope(
  shotNo: string,
  expectedShotNos: string[]
): boolean {
  const normalized = String(shotNo || '').trim();
  if (!normalized) return false;
  return expectedShotNos.some((shot) => storyboardShotNosMatch(shot, normalized));
}

export function buildUniformSheetGridBoxes(cellCount: number): BoundingBox[] {
  const { cols, rows: gridRows } = computeStoryboardMosaicGrid(cellCount);
  const margin = 4;
  const boxes: BoundingBox[] = [];
  const cellW = 1000 / cols;
  const cellH = 1000 / gridRows;
  for (let index = 0; index < cellCount; index += 1) {
    const col = index % cols;
    const rowIdx = Math.floor(index / cols);
    boxes.push({
      id: `grid-${index}`,
      label: String(index + 1),
      xmin: Math.max(0, Math.round(col * cellW + margin)),
      ymin: Math.max(0, Math.round(rowIdx * cellH + margin)),
      xmax: Math.min(1000, Math.round((col + 1) * cellW - margin)),
      ymax: Math.min(1000, Math.round((rowIdx + 1) * cellH - margin)),
    });
  }
  return boxes;
}

export async function splitStoryboardSheetByUniformGrid(
  dataUrl: string,
  rows: StoryboardTableRow[]
): Promise<StoryboardSheetVisionSplitResult> {
  if (!rows.length) return { matches: [], unmatchedLabels: [] };

  const boxes = buildUniformSheetGridBoxes(rows.length);
  const crops = await cropBoxes(
    dataUrl,
    boxes,
    boxes.map((_, index) => index),
    2
  );

  const matches: StoryboardSheetVisionMatch[] = [];
  const unmatchedLabels: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const image = crops[index];
    if (!image) {
      unmatchedLabels.push(row.shotNo?.trim() || `row-${index + 1}`);
      continue;
    }
    matches.push({
      rowId: row.id,
      shotNo: row.shotNo?.trim() || '',
      label: row.shotNo?.trim() || boxes[index]!.label,
      image,
      box: boxes[index]!,
    });
  }

  return {
    matches,
    unmatchedLabels,
    warn: unmatchedLabels.length ? `网格切分 ${matches.length}/${rows.length} 镜` : undefined,
  };
}

export async function splitStoryboardSheetByVision(
  dataUrl: string,
  rows: StoryboardTableRow[],
  textModel = DEFAULT_MODEL_TEXT,
  options?: { timeoutMs?: number; autoCreateRows?: boolean; expectedShotNos?: string[] }
): Promise<StoryboardSheetVisionSplitResult> {
  const expectedShotNos =
    options?.expectedShotNos?.map((shot) => shot.trim()).filter(Boolean) ??
    rows.map((row) => row.shotNo?.trim() || '').filter(Boolean);
  let boxes: BoundingBox[] = [];
  let warn: string | undefined;

  try {
    boxes = await detectStoryboardSheetPanels(dataUrl, expectedShotNos, textModel, options);
  } catch (error) {
    return {
      matches: [],
      unmatchedLabels: [],
      warn: error instanceof Error ? error.message : '视觉识别切分失败',
    };
  }

  if (!boxes.length) {
    return {
      matches: [],
      unmatchedLabels: [],
      warn: '视觉识别未找到分镜格，请检查生成图是否含清晰镜号与分隔线',
    };
  }

  const workingRows = filterStoryboardRowsByExpectedShots([...rows], expectedShotNos);
  const createdRows: StoryboardTableRow[] = [];
  const usedRowIds = new Set<string>();
  const matches: StoryboardSheetVisionMatch[] = [];
  const unmatchedLabels: string[] = [];

  const crops = await cropBoxes(
    dataUrl,
    boxes,
    boxes.map((_, index) => index),
    4
  );

  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i]!;
    const image = crops[i];
    let row = matchVisionBoxToRow(
      box,
      workingRows.filter((item) => !usedRowIds.has(item.id))
    );

    if (!row && options?.autoCreateRows) {
      const shotNo = visionLabelToShotNo(box.label);
      if (shotNo && isStoryboardShotNoInExpectedScope(shotNo, expectedShotNos)) {
        row = createStoryboardTableRow({ shotNo }, workingRows.length);
        workingRows.push(row);
        createdRows.push(row);
      }
    }

    if (!row || usedRowIds.has(row.id) || !image) {
      unmatchedLabels.push(box.label || box.id);
      continue;
    }
    usedRowIds.add(row.id);
    matches.push({
      rowId: row.id,
      shotNo: row.shotNo?.trim() || visionLabelToShotNo(box.label),
      label: box.label,
      image,
      box,
    });
  }

  if (!matches.length) {
    warn = '已识别分镜格，但镜号与表内镜头无法匹配';
  } else if (unmatchedLabels.length) {
    warn = `${unmatchedLabels.length} 个识别格未能匹配镜号：${unmatchedLabels.slice(0, 4).join('、')}`;
  }

  const initialMatchCount = matches.length;
  if (workingRows.length > 0 && matches.length < workingRows.length) {
    const grid = await splitStoryboardSheetByUniformGrid(dataUrl, workingRows);
    const matchedIds = new Set(matches.map((match) => match.rowId));
    for (const gridMatch of grid.matches) {
      if (matchedIds.has(gridMatch.rowId)) continue;
      matches.push(gridMatch);
      matchedIds.add(gridMatch.rowId);
    }
    if (matches.length > initialMatchCount) {
      const gridFilled = matches.length - initialMatchCount;
      const gridWarn = `视觉切分 ${initialMatchCount}/${workingRows.length} 镜，其余 ${gridFilled} 镜已按均匀网格回填`;
      warn = warn ? `${warn}；${gridWarn}` : gridWarn;
    }
  }

  return {
    matches,
    unmatchedLabels,
    warn,
    createdRows: createdRows.length ? createdRows : undefined,
  };
}
