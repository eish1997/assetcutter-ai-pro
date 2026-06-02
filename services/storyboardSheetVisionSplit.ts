import type { BoundingBox, StoryboardTableRow } from '../types';
import { createStoryboardTableRow } from './storyboardTableAsset';
import { normalizeStoryboardShotNoInput } from './storyboardTableParse';
import { computeStoryboardMosaicGrid } from './storyboardFrameStripMerge';
import { cropBoxes, trimImageDataUrlContentBounds } from './imageCrop';
import { detectObjectsInImage } from './unifiedAiGateway';
import { DEFAULT_MODEL_TEXT } from './modelRegistry/constants';

export const STORYBOARD_SHEET_VISION_TIMEOUT_MS = 90_000;

export type StoryboardSheetLayoutGrid = {
  cols: number;
  rows: number;
};

export type StoryboardSheetVisionSplitOptions = {
  timeoutMs?: number;
  autoCreateRows?: boolean;
  expectedShotNos?: string[];
  customPrompt?: string;
  /** false = 视觉不全时不做网格回填（上传拼图推荐） */
  allowGridFallback?: boolean;
  /** 指定列行时，网格回填按此布局从左到右、从上到下对应镜号顺序 */
  layoutGrid?: StoryboardSheetLayoutGrid;
};

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

  return `你是分镜表拼图切分助手。输入是一张包含多个分镜格的故事板拼图页（contact sheet 或手绘分镜页）。

任务分两步理解每一格：
1. 读取镜号：从该格内可读位置读取镜号（顶部元数据条、左上角/右上角角标如 002/010、SC01_SH001 等），写入 label；
2. 框选画面：box_2d 只框住该格的「草图/插画」主体区域，用于回填分镜图。

box_2d 必须排除（不要框进）：
- 顶部/底部元数据与说明文字条（景别、角度、运镜、时长、对白、旁白等）；
- 左右两侧的纯文字栏（若有）；
- 相邻分镜格的内容（严禁跨格合并）；
- 标注箭头、运动线等辅助线若在外围可略去，但不得裁到下一格。

box_2d 应紧贴草图外轮廓，略留 1–2% 边距；每格单独一框，宽高比例应接近该格真实画面（禁止输出极窄竖条或极扁横条）。

常见版式：
- 竖格：上文字 / 中画面 / 下文字 → 只框中间画面；
- 横格：左文字 / 右草图 → 只框右侧草图；
- 不规则手绘页：按黑色/白色分隔线识别独立分镜格，每格一个框。

label 规则：
- 读取每格镜号文字（如 002、S030、SC01_SH001），原样写入 label；
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

/** 过滤 AI 误检的窄条/过小框，避免切出竖条污染回填 */
export function filterVisionBoxesByQuality(boxes: BoundingBox[]): BoundingBox[] {
  if (boxes.length <= 1) return boxes;

  const widths = boxes.map((box) => box.xmax - box.xmin).sort((a, b) => a - b);
  const heights = boxes.map((box) => box.ymax - box.ymin).sort((a, b) => a - b);
  const areas = boxes
    .map((box) => (box.xmax - box.xmin) * (box.ymax - box.ymin))
    .sort((a, b) => a - b);
  const medianW = widths[Math.floor(widths.length / 2)] ?? 0;
  const medianH = heights[Math.floor(heights.length / 2)] ?? 0;
  const medianArea = areas[Math.floor(areas.length / 2)] ?? 0;
  if (medianW <= 0 || medianH <= 0 || medianArea <= 0) return boxes;

  return boxes.filter((box) => {
    const w = box.xmax - box.xmin;
    const h = box.ymax - box.ymin;
    const area = w * h;
    if (w < medianW * 0.18 || h < medianH * 0.18) return false;
    if (area < medianArea * 0.14) return false;
    const aspect = w / Math.max(h, 1);
    if (aspect < 0.12 || aspect > 8.5) return false;
    return true;
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

export function newStoryboardSheetSplitBoxId(): string {
  return `box-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeStoryboardSheetSplitBox(raw: BoundingBox): BoundingBox {
  const xmin = Math.max(0, Math.min(1000, Math.min(raw.xmin, raw.xmax)));
  const xmax = Math.max(0, Math.min(1000, Math.max(raw.xmin, raw.xmax)));
  const ymin = Math.max(0, Math.min(1000, Math.min(raw.ymin, raw.ymax)));
  const ymax = Math.max(0, Math.min(1000, Math.max(raw.ymin, raw.ymax)));
  return {
    id: String(raw.id || '').trim() || newStoryboardSheetSplitBoxId(),
    label: String(raw.label || '').trim() || '',
    xmin,
    ymin,
    xmax,
    ymax,
  };
}

export function clampStoryboardSheetSplitBox(box: BoundingBox, minSpan = 24): BoundingBox {
  const normalized = normalizeStoryboardSheetSplitBox(box);
  if (normalized.xmax - normalized.xmin < minSpan) {
    const mid = (normalized.xmin + normalized.xmax) / 2;
    normalized.xmin = Math.max(0, mid - minSpan / 2);
    normalized.xmax = Math.min(1000, mid + minSpan / 2);
  }
  if (normalized.ymax - normalized.ymin < minSpan) {
    const mid = (normalized.ymin + normalized.ymax) / 2;
    normalized.ymin = Math.max(0, mid - minSpan / 2);
    normalized.ymax = Math.min(1000, mid + minSpan / 2);
  }
  return normalized;
}

export async function splitStoryboardSheetFromBoxes(
  dataUrl: string,
  rows: StoryboardTableRow[],
  inputBoxes: BoundingBox[],
  options?: StoryboardSheetVisionSplitOptions
): Promise<StoryboardSheetVisionSplitResult> {
  const expectedShotNos =
    options?.expectedShotNos?.map((shot) => shot.trim()).filter(Boolean) ??
    rows.map((row) => row.shotNo?.trim() || '').filter(Boolean);
  const boxes = inputBoxes.map((box) => clampStoryboardSheetSplitBox(box));
  if (!boxes.length) {
    return {
      matches: [],
      unmatchedLabels: [],
      warn: '未提供切分框，请至少框选一个分镜格',
    };
  }

  const workingRows = filterStoryboardRowsByExpectedShots([...rows], expectedShotNos);
  const createdRows: StoryboardTableRow[] = [];
  const usedRowIds = new Set<string>();
  const matches: StoryboardSheetVisionMatch[] = [];
  const unmatchedLabels: string[] = [];
  let warn: string | undefined;

  const crops = await trimVisionSplitCrops(
    await cropBoxes(
      dataUrl,
      boxes,
      boxes.map((_, index) => index),
      4
    )
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
      if (shotNo) {
        row =
          workingRows.find(
            (item) =>
              !usedRowIds.has(item.id) &&
              item.shotNo?.trim() &&
              storyboardShotNosMatch(item.shotNo, shotNo)
          ) ?? null;
      }
      if (
        !row &&
        shotNo &&
        isStoryboardShotNoInExpectedScope(shotNo, expectedShotNos)
      ) {
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
  const allowGridFallback = options?.allowGridFallback !== false;

  if (workingRows.length > 0 && matches.length < workingRows.length && allowGridFallback) {
    const grid = options?.layoutGrid
      ? await splitStoryboardSheetByLayoutGrid(dataUrl, workingRows, options.layoutGrid)
      : await splitStoryboardSheetByUniformGrid(dataUrl, workingRows);
    const matchedIds = new Set(matches.map((match) => match.rowId));
    for (const gridMatch of grid.matches) {
      if (matchedIds.has(gridMatch.rowId)) continue;
      matches.push(gridMatch);
      matchedIds.add(gridMatch.rowId);
    }
    if (matches.length > initialMatchCount) {
      const gridFilled = matches.length - initialMatchCount;
      const gridLabel = options?.layoutGrid ? '指定行列布局' : '均匀网格';
      const gridWarn = `视觉切分 ${initialMatchCount}/${workingRows.length} 镜，其余 ${gridFilled} 镜已按${gridLabel}回填`;
      warn = warn ? `${warn}；${gridWarn}` : gridWarn;
    }
  } else if (workingRows.length > 0 && matches.length < workingRows.length && !allowGridFallback) {
    const missing = workingRows.length - matches.length;
    const partialWarn = `切分 ${matches.length}/${workingRows.length} 镜，${missing} 镜未匹配（可在弹窗中增删框后重切，或在编辑页手动补图）`;
    warn = warn ? `${warn}；${partialWarn}` : partialWarn;
  }

  return {
    matches,
    unmatchedLabels,
    warn,
    createdRows: createdRows.length ? createdRows : undefined,
  };
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
  const deduped = dedupeBoxesByLabel(boxes);
  const quality = filterVisionBoxesByQuality(deduped);
  return mapStoryboardBoxesToVisualCrop(quality.length ? quality : deduped);
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

export function suggestStoryboardSheetLayoutGrid(cellCount: number): StoryboardSheetLayoutGrid {
  const { cols, rows } = computeStoryboardMosaicGrid(cellCount);
  return { cols, rows };
}

export function parseStoryboardSheetLayoutGrid(
  colsRaw: string,
  rowsRaw: string,
  shotCount: number
): { ok: true; layout: StoryboardSheetLayoutGrid } | { ok: false; error: string } {
  const colsText = String(colsRaw || '').trim();
  const rowsText = String(rowsRaw || '').trim();
  if (!colsText && !rowsText) {
    return { ok: false, error: '未填写行列' };
  }
  if (!colsText || !rowsText) {
    return { ok: false, error: '请同时填写列数与行数' };
  }
  const cols = Number.parseInt(colsText, 10);
  const rows = Number.parseInt(rowsText, 10);
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) {
    return { ok: false, error: '列数与行数须为正整数' };
  }
  if (cols > 12 || rows > 12) {
    return { ok: false, error: '列数与行数不能超过 12' };
  }
  if (cols * rows < shotCount) {
    return { ok: false, error: `列×行（${cols * rows}）须 ≥ 镜数（${shotCount}）` };
  }
  return { ok: true, layout: { cols, rows } };
}

export function buildLayoutSheetGridBoxes(
  layout: StoryboardSheetLayoutGrid,
  cellCount: number
): BoundingBox[] {
  const cols = Math.max(1, Math.min(12, Math.round(layout.cols)));
  const gridRows = Math.max(1, Math.min(12, Math.round(layout.rows)));
  const margin = 4;
  const cellW = 1000 / cols;
  const cellH = 1000 / gridRows;
  const boxes: BoundingBox[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    const col = index % cols;
    const rowIdx = Math.floor(index / cols);
    if (rowIdx >= gridRows) break;
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

export function buildUniformSheetGridBoxes(cellCount: number): BoundingBox[] {
  return buildLayoutSheetGridBoxes(suggestStoryboardSheetLayoutGrid(cellCount), cellCount);
}

async function trimVisionSplitCrops(crops: string[]): Promise<string[]> {
  const trimmed: string[] = [];
  for (const crop of crops) {
    trimmed.push(crop ? await trimImageDataUrlContentBounds(crop) : '');
  }
  return trimmed;
}

async function splitStoryboardSheetByGridBoxes(
  dataUrl: string,
  rows: StoryboardTableRow[],
  boxes: BoundingBox[],
  warnPrefix: string
): Promise<StoryboardSheetVisionSplitResult> {
  if (!rows.length) return { matches: [], unmatchedLabels: [] };

  const crops = await trimVisionSplitCrops(
    await cropBoxes(
      dataUrl,
      boxes,
      boxes.map((_, index) => index),
      2
    )
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
    warn: unmatchedLabels.length ? `${warnPrefix} ${matches.length}/${rows.length} 镜` : undefined,
  };
}

export async function splitStoryboardSheetByLayoutGrid(
  dataUrl: string,
  rows: StoryboardTableRow[],
  layout: StoryboardSheetLayoutGrid
): Promise<StoryboardSheetVisionSplitResult> {
  const boxes = buildLayoutSheetGridBoxes(layout, rows.length);
  return splitStoryboardSheetByGridBoxes(dataUrl, rows, boxes, '布局网格切分');
}

export async function splitStoryboardSheetByUniformGrid(
  dataUrl: string,
  rows: StoryboardTableRow[]
): Promise<StoryboardSheetVisionSplitResult> {
  const boxes = buildUniformSheetGridBoxes(rows.length);
  return splitStoryboardSheetByGridBoxes(dataUrl, rows, boxes, '均匀网格切分');
}

export async function splitStoryboardSheetByVision(
  dataUrl: string,
  rows: StoryboardTableRow[],
  textModel = DEFAULT_MODEL_TEXT,
  options?: StoryboardSheetVisionSplitOptions
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
    if (options?.layoutGrid && options.allowGridFallback !== false) {
      const workingRows = filterStoryboardRowsByExpectedShots([...rows], expectedShotNos);
      const grid = await splitStoryboardSheetByLayoutGrid(dataUrl, workingRows, options.layoutGrid);
      return {
        ...grid,
        warn: grid.warn ?? '视觉识别未找到分镜格，已按指定行列布局切分',
      };
    }
    return {
      matches: [],
      unmatchedLabels: [],
      warn: '视觉识别未找到分镜格，请检查拼图是否含清晰镜号与分隔线，或填写行列布局后重切',
    };
  }

  return splitStoryboardSheetFromBoxes(dataUrl, rows, boxes, options);
}
