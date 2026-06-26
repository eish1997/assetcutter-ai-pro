import type { BoundingBox, StoryboardTableRow } from '../types';
import { createStoryboardTableRow } from './storyboardTableAsset';
import { normalizeStoryboardShotNoInput } from './storyboardTableParse';
import { computeStoryboardMosaicGrid } from './storyboardFrameStripMerge';
import { cropBoxes, refineStoryboardNormBoxesToIllustrationBounds, trimImageDataUrlContentBounds } from './imageCrop';
import { scaleStoryboardSheetForVisionDetect } from '../components/storyboard/storyboardFrameImage';
import { detectObjectsInImage, analyzeStoryboardSheetStructureInImage } from './unifiedAiGateway';
import { DEFAULT_MODEL_TEXT } from './modelRegistry/constants';
import { detectAutoGrid, detectStoryboardGridBoxesForLayout } from './gridDetector';
import { auditStoryboardTaskOutcome } from './storyboardTaskAuditEvents';

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
  /** false = 切分后不做内容裁白边（拼图生图推荐，避免空格子被裁成异常小图） */
  trimSplitCrops?: boolean;
  /** 分镜表资产 id：视觉识别任务审计上报管理端 */
  storyboardAssetId?: string;
  /** 框数与镜头数不一致时，按阅读顺序配前 N 对（拖入切分） */
  sequentialLayoutMatch?: boolean;
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
  const explicit = text.match(/\b(?:SC\d+[_-]?SH?\d+)\b/i);
  if (explicit?.[0]) return normalizeShotNoToken(explicit[0]);
  const sStyle = text.match(/\bS\d{2,4}\b/i);
  if (sStyle?.[0]) return normalizeShotNoToken(sStyle[0]);
  const leadingDigits = text.match(/^#?(\d{1,4})\b/);
  if (leadingDigits?.[1]) return normalizeShotNoToken(leadingDigits[1]);
  const explicit2 = text.match(/\b(?:SC\d+[_-]?)?S?\d{2,4}\b/i);
  if (explicit2?.[0]) return normalizeShotNoToken(explicit2[0]);
  return normalizeShotNoToken(text);
}

const SHOT_NO_METADATA_HINT =
  /景别|构图|角度|运镜|时长|秒|fps|帧|对白|旁白|台词|备注|镜头运动|转场|音效|音乐|Wide|Medium|Close|Long|Full|ECU|CU|MS|LS|MCU|特写|近景|中景|远景|全景|俯|仰|平|跟|摇|移|推拉/i;

/** 从格内混合文字（位置不固定）推断镜号 */
export function inferShotNoFromMixedText(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';

  const compact = text.replace(/\s+/g, ' ');
  const headerShot = compact.match(/^(\d{1,4})\s*\|/);
  if (headerShot?.[1]) return normalizeStoryboardShotNoInput(headerShot[1]);

  if (compact.length <= 16 && !SHOT_NO_METADATA_HINT.test(compact)) {
    const direct = extractShotNoToken(compact);
    if (direct) return normalizeStoryboardShotNoInput(direct);
  }

  for (const match of compact.matchAll(
    /(?:镜号|镜头号|镜头|Shot|SHOT|SCENE|Scene|#)\s*[：:#\-]?\s*([A-Za-z0-9_\-]+)/gi
  )) {
    const token = extractShotNoToken(match[1] || '');
    if (token) return normalizeStoryboardShotNoInput(token);
  }

  const scMatch = compact.match(/\bSC\d+[_-]?SH?\d+\b/i);
  if (scMatch?.[0]) return normalizeStoryboardShotNoInput(scMatch[0]);

  const parts = compact.split(/[|/,，、;；]+/).flatMap((part) => part.trim().split(/\s+/));
  const candidates: { token: string; score: number }[] = [];
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    if (SHOT_NO_METADATA_HINT.test(part)) continue;
    if (/^\d+\s*s$/i.test(part)) continue;
    const token = extractShotNoToken(part);
    if (!token) continue;
    let score = 20;
    if (/^SC\d/i.test(token)) score = 95;
    else if (/^S\d{2,4}$/i.test(token)) score = 90;
    else if (/^\d{3,4}$/.test(token)) score = 85;
    else if (/^\d{2}$/.test(token)) score = 75;
    else if (/^\d$/.test(token)) score = 35;
    candidates.push({ token, score });
  }

  if (!candidates.length) {
    for (const match of compact.matchAll(/\b(\d{2,4})\b/g)) {
      const token = match[1];
      if (!token) continue;
      const ctx = compact.slice(
        Math.max(0, (match.index ?? 0) - 6),
        Math.min(compact.length, (match.index ?? 0) + token.length + 6)
      );
      if (SHOT_NO_METADATA_HINT.test(ctx)) continue;
      candidates.push({ token, score: 55 });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return best ? normalizeStoryboardShotNoInput(best.token) : '';
}

export function sortStoryboardSheetBoxesReadingOrder(boxes: BoundingBox[]): BoundingBox[] {
  return [...boxes].sort((a, b) => {
    const rowA = Math.round(a.ymin / 80);
    const rowB = Math.round(b.ymin / 80);
    if (rowA !== rowB) return rowA - rowB;
    return a.xmin - b.xmin;
  });
}

function enrichVisionDetectBoxLabels(boxes: BoundingBox[]): BoundingBox[] {
  return sortStoryboardSheetBoxesReadingOrder(boxes).map((box, index) => {
    const inferred = inferShotNoFromMixedText(box.label);
    const label = inferred || box.label.trim() || `#${index + 1}`;
    return { ...box, label };
  });
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

export type StoryboardSheetStructureAnalysis = {
  shotCount: number;
  cols: number;
  rows: number;
  shotNos: string[];
  emptyCellCount: number;
};

export function buildStoryboardSheetVisionPrompt(
  expectedShotNos: string[],
  structure?: StoryboardSheetStructureAnalysis
): string {
  const expected = [...new Set(expectedShotNos.map((shot) => shot.trim()).filter(Boolean))];
  const structureLine = structure
    ? `已确认：${structure.rows} 行 × ${structure.cols} 列网格，共 ${structure.shotCount} 个有效分镜格${
        structure.emptyCellCount > 0 ? `（另有 ${structure.emptyCellCount} 个空白占位格勿框）` : ''
      }。镜号顺序：${structure.shotNos.join('、')}。必须且只能输出 ${structure.shotCount} 个 box_2d。`
    : '';
  const expectedCountLine =
    expected.length > 0
      ? `本拼图共 ${expected.length} 个分镜格，必须且只能输出 ${expected.length} 个 box_2d（每格一个，禁止把顶栏小字、时长、对白单独成框）。`
      : structure
        ? ''
        : '';
  const expectedLine = expected.length
    ? `本图可能包含下列镜号（若格内文字与之一致，label 须与之相同）：${expected.join('、')}。`
    : `本图镜号未知：须先逐格阅读全部文字，再从每格文字中自行推断镜号（位置不固定）。`;

  return `你是分镜表拼图切分助手。输入是一张包含多个分镜格的故事板拼图页（contact sheet 或手绘分镜页）。

${structureLine}

${expectedCountLine}

【最重要】若图中有多个分镜格（常见为带黑色/灰色网格线的规整宫格，如 3×3、4×5、5×4 等），必须为每一格各输出一个 box_2d，严禁把整张拼图当作一个框返回。

规整网格分镜表（漫画/影视分镜条）识别要点：
- 先数清列数×行数，再沿网格线逐格定位；
- 每格通常含：顶部镜号条、中间插画/草图、底部动作/对白文字；
- box_2d 必须只框中间插画/草图主体，严禁包含顶部镜号条与底部文字条；
- label 仍读取顶部镜号条中的镜号（如 121），不要写时长（4s）或对白内容。

任务分三步处理每一格：
1. 读字：扫描该格内全部可见文字，推断镜号（位置不固定）；
2. 猜镜号：从文字中推断镜号（排除景别、角度、运镜、时长、对白等）；
3. 框画面：box_2d 只框该格中间插画/草图，上下文字区必须排除在外。

box_2d 必须排除（不要框进）：
- 相邻分镜格的内容（严禁跨格合并）；
- 顶部镜号/元数据条、底部对白/动作/备注等纯文字区（各格高度不固定，按实际画面边界识别，禁止按固定比例裁切）。

box_2d 应紧贴该格外轮廓，略留 1–2% 边距；每格单独一框（禁止输出极窄竖条或极扁横条）。

常见版式：
- 规整宫格：黑色网格线分隔，每格一个框（优先识别此类）；
- 竖格：上文字 / 中画面 / 下文字 → 只框中间画面或整格；
- 横格：左文字 / 右草图 → 只框右侧草图；
- 不规则手绘页：按分隔线识别独立分镜格，每格一个框。

label 规则（重要）：
- 写入你从该格文字中推断出的镜号；优先短而明确的编号（如 121、002、S030、SC01_SH001）；
- 若只能读到混合文本，label 可写最像镜号的片段，或写整段短文字供程序解析；
- 看不清镜号时不要跳过该格：仍输出 box_2d，label 可留空；
- 不要编造与画面无关的镜号；同一镜号只保留一个框（取画面最完整的一格）。

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
  const labelCandidates = [
    box.label,
    inferShotNoFromMixedText(box.label),
    extractShotNoToken(box.label),
  ].filter(Boolean);
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
  const enriched = enrichVisionDetectBoxLabels(boxes);
  const byLabel = new Map<string, BoundingBox>();
  for (const box of enriched) {
    const key =
      extractShotNoToken(box.label) ||
      inferShotNoFromMixedText(box.label) ||
      box.label.trim() ||
      box.id;
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
  return sortStoryboardSheetBoxesReadingOrder([...byLabel.values()]);
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
  const orderedBoxes = sortStoryboardSheetBoxesReadingOrder(boxes).map((box) =>
    clampStoryboardSheetSplitBox(box)
  );
  if (!orderedBoxes.length) {
    return {
      matches: [],
      unmatchedLabels: [],
      warn: '未提供切分框，请至少框选一个分镜格',
    };
  }

  /** 已知 layoutGrid 且框数与镜头数一致（或允许顺序部分匹配）：按阅读顺序一一对应 */
  if (options?.layoutGrid && workingRows.length > 0) {
    const pairCount = Math.min(orderedBoxes.length, workingRows.length);
    if (
      pairCount > 0 &&
      (orderedBoxes.length === workingRows.length || options.sequentialLayoutMatch)
    ) {
      return splitStoryboardSheetByGridBoxes(
        dataUrl,
        workingRows.slice(0, pairCount),
        orderedBoxes.slice(0, pairCount),
        orderedBoxes.length === workingRows.length ? '布局顺序切分' : '布局顺序切分（部分镜）',
        { trimCrops: options.trimSplitCrops !== false }
      );
    }
  }

  const createdRows: StoryboardTableRow[] = [];
  const usedRowIds = new Set<string>();
  const matches: StoryboardSheetVisionMatch[] = [];
  const unmatchedLabels: string[] = [];
  let warn: string | undefined;

  const crops = await trimVisionSplitCrops(
    await cropBoxes(
      dataUrl,
      orderedBoxes,
      orderedBoxes.map((_, index) => index),
      4
    )
  );

  const resolveRowForBox = (
    box: BoundingBox,
    positionIndex: number
  ): StoryboardTableRow | null => {
    const availableRows = workingRows.filter((item) => !usedRowIds.has(item.id));
    let row = matchVisionBoxToRow(box, availableRows);
    if (row) return row;

    const shotNo = visionLabelToShotNo(box.label);
    if (options?.autoCreateRows && shotNo) {
      row =
        availableRows.find(
          (item) => item.shotNo?.trim() && storyboardShotNosMatch(item.shotNo, shotNo)
        ) ?? null;
      if (!row && isStoryboardShotNoInExpectedScope(shotNo, expectedShotNos)) {
        row = createStoryboardTableRow({ shotNo }, workingRows.length);
        workingRows.push(row);
        createdRows.push(row);
      }
      if (row) return row;
    }

    if (!expectedShotNos.length) {
      if (positionIndex < availableRows.length) {
        return availableRows[positionIndex]!;
      }
      if (options?.autoCreateRows) {
        const seqShot =
          shotNo || String(positionIndex + 1).padStart(3, '0');
        row = createStoryboardTableRow({ shotNo: seqShot }, workingRows.length);
        workingRows.push(row);
        createdRows.push(row);
        return row;
      }
    }

    return null;
  };

  for (let i = 0; i < orderedBoxes.length; i += 1) {
    const box = orderedBoxes[i]!;
    const image = crops[i];
    const row = resolveRowForBox(box, i);

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
    warn = expectedShotNos.length
      ? '已识别分镜格，但镜号与表内镜头无法匹配'
      : '已识别分镜格，但未能回填镜头（可手动调整切分框）';
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

function boxArea(box: BoundingBox): number {
  return Math.max(0, box.xmax - box.xmin) * Math.max(0, box.ymax - box.ymin);
}

/** 视觉模型是否把整张拼图收成一两个大框 */
export function isCollapsedStoryboardSheetVisionDetect(boxes: BoundingBox[]): boolean {
  if (!boxes.length) return true;
  const sorted = [...boxes].sort((a, b) => boxArea(b) - boxArea(a));
  const largest = boxArea(sorted[0]!);
  const totalArea = 1_000_000;
  if (boxes.length === 1 && largest > totalArea * 0.45) return true;
  if (boxes.length <= 2 && largest > totalArea * 0.55) return true;
  if (boxes.length <= 3 && largest > totalArea * 0.65) return true;
  return false;
}

export type StoryboardSheetGridBounds = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

export type StoryboardSheetPanelEstimate = {
  panelCount: number;
  layoutGrid: StoryboardSheetLayoutGrid;
  method: string;
  contentBounds?: StoryboardSheetGridBounds;
  structureAnalysis?: StoryboardSheetStructureAnalysis;
};

export type StoryboardSheetVisionDetectOptions = {
  timeoutMs?: number;
  customPrompt?: string;
  storyboardAssetId?: string;
  layoutGrid?: StoryboardSheetLayoutGrid;
  /** 已知 layoutGrid 时跳过 Gemini，仅均匀网格 + 像素收窄插画区（拖入/生图切分推荐） */
  skipVisionDetect?: boolean;
  /** 图内分镜格数（拖入切分：以图为准，可与选中镜数不同） */
  panelCount?: number;
  /** 主内容区（跳过顶栏缩略图条等） */
  contentBounds?: StoryboardSheetGridBounds;
  /** 视觉结构预分析（镜数/行列/镜号），优先于像素估格 */
  structureAnalysis?: StoryboardSheetStructureAnalysis;
  /** 识别过程状态文案（弹窗内分阶段展示） */
  onDetectStatus?: (message: string) => void;
};

type SheetImageGray = {
  gray: Uint8Array;
  width: number;
  height: number;
};

function loadSheetImageForGrid(src: string): Promise<SheetImageGray | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) {
        resolve(null);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const gray = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i += 1) {
        const idx = i * 4;
        gray[i] =
          (pixels[idx]! * 299 + pixels[idx + 1]! * 587 + pixels[idx + 2]! * 114) / 1000;
      }
      resolve({ gray, width, height });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function lineDarknessScore(
  gray: Uint8Array,
  width: number,
  height: number,
  axis: 'v' | 'h',
  positionPx: number,
  thickness = 3
): number {
  let dark = 0;
  let total = 0;
  if (axis === 'v') {
    for (let dy = -thickness; dy <= thickness; dy += 1) {
      const x = Math.min(width - 1, Math.max(0, positionPx + dy));
      for (let y = 0; y < height; y += 1) {
        if (gray[y * width + x]! < 100) dark += 1;
        total += 1;
      }
    }
  } else {
    for (let dx = -thickness; dx <= thickness; dx += 1) {
      const y = Math.min(height - 1, Math.max(0, positionPx + dx));
      for (let x = 0; x < width; x += 1) {
        if (gray[y * width + x]! < 100) dark += 1;
        total += 1;
      }
    }
  }
  return total > 0 ? dark / total : 0;
}

export function scoreStoryboardSheetUniformGridLayout(
  img: SheetImageGray,
  cols: number,
  rows: number
): number {
  if (cols < 2 || rows < 2) return 0;
  let score = 0;
  let count = 0;
  for (let c = 1; c < cols; c += 1) {
    const x = Math.round((c * img.width) / cols);
    score += lineDarknessScore(img.gray, img.width, img.height, 'v', x);
    count += 1;
  }
  for (let r = 1; r < rows; r += 1) {
    const y = Math.round((r * img.height) / rows);
    score += lineDarknessScore(img.gray, img.width, img.height, 'h', y);
    count += 1;
  }
  return count > 0 ? score / count : 0;
}

const STORYBOARD_SHEET_MIN_PANEL_AREA = 10_000;

/** 顶栏缩略图条：大量小格挤在画面上部 */
export function isLikelyHeaderStripNoise(boxes: BoundingBox[]): boolean {
  if (boxes.length < 10) return false;
  const areas = boxes.map((box) => boxArea(box)).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)]!;
  if (median > 18_000) return false;
  const avgY =
    boxes.reduce((sum, box) => sum + (box.ymin + box.ymax) / 2, 0) / boxes.length;
  if (avgY > 420) return false;
  const inTopBand = boxes.filter((box) => box.ymax < 480).length;
  return inTopBand / boxes.length >= 0.55;
}

/** 主内容区边界：大格聚簇区域，或跳过顶栏后的默认区 */
export function inferStoryboardSheetMainContentBounds(
  boxes: BoundingBox[]
): StoryboardSheetGridBounds | null {
  const large = boxes.filter((box) => boxArea(box) >= STORYBOARD_SHEET_MIN_PANEL_AREA);
  if (large.length >= 2) {
    const pad = 6;
    return {
      xmin: Math.max(0, Math.min(...large.map((b) => b.xmin)) - pad),
      ymin: Math.max(0, Math.min(...large.map((b) => b.ymin)) - pad),
      xmax: Math.min(1000, Math.max(...large.map((b) => b.xmax)) + pad),
      ymax: Math.min(1000, Math.max(...large.map((b) => b.ymax)) + pad),
    };
  }
  if (isLikelyHeaderStripNoise(boxes)) {
    return { xmin: 0, ymin: 220, xmax: 1000, ymax: 995 };
  }
  return null;
}

export function pickStoryboardSheetUniformGridLayout(
  img: SheetImageGray,
  opts?: { minScore?: number; hintCount?: number; contentBounds?: StoryboardSheetGridBounds }
): { cols: number; rows: number; score: number } | null {
  const bounds = opts?.contentBounds;
  const regionH =
    bounds && bounds.ymax > bounds.ymin
      ? ((bounds.ymax - bounds.ymin) / 1000) * img.height
      : img.height;
  const regionW =
    bounds && bounds.xmax > bounds.xmin
      ? ((bounds.xmax - bounds.xmin) / 1000) * img.width
      : img.width;

  const ranked: { cols: number; rows: number; score: number; cells: number }[] = [];
  for (let cols = 2; cols <= 8; cols += 1) {
    for (let rows = 2; rows <= 8; rows += 1) {
      const cells = cols * rows;
      if (cells < 4 || cells > 40) continue;
      const cellH = regionH / rows;
      const cellW = regionW / cols;
      if (cellH < img.height * 0.055 || cellW < img.width * 0.07) continue;
      const score = scoreStoryboardSheetUniformGridLayout(img, cols, rows);
      ranked.push({ cols, rows, score, cells });
    }
  }
  if (!ranked.length) return null;
  ranked.sort((a, b) => b.score - a.score);
  const topScore = ranked[0]!.score;
  const minScore = opts?.minScore ?? 0.04;
  if (topScore < minScore) return null;
  const threshold = topScore * 0.72;
  let viable = ranked.filter((item) => item.score >= threshold);
  if (!viable.length) viable = ranked.slice(0, 5);

  const hint = opts?.hintCount && opts.hintCount > 1 ? opts.hintCount : undefined;
  if (hint) {
    viable.sort((a, b) => {
      const diffA = Math.abs(a.cells - hint);
      const diffB = Math.abs(b.cells - hint);
      if (diffA !== diffB) return diffA - diffB;
      return b.score - a.score;
    });
  } else {
    viable.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) > topScore * 0.08) return scoreDiff;
      return a.cells - b.cells;
    });
  }
  const pick = viable[0] ?? ranked[0]!;
  return { cols: pick.cols, rows: pick.rows, score: pick.score };
}

/** 去掉 auto grid 误检：四宫格大块、顶栏缩略图小格 */
export function filterStoryboardAutoGridToPanelCells(boxes: BoundingBox[]): BoundingBox[] {
  if (boxes.length <= 4) return sortStoryboardSheetBoxesReadingOrder(boxes);
  const withArea = boxes
    .map((box) => ({ box, area: boxArea(box) }))
    .filter((item) => item.area > 20 * 20)
    .sort((a, b) => a.area - b.area);
  if (withArea.length <= 4) {
    return sortStoryboardSheetBoxesReadingOrder(withArea.map((item) => item.box));
  }

  let filtered = withArea;
  let maxGap = 0;
  let splitIdx = 0;
  for (let i = 1; i < withArea.length; i += 1) {
    const gap = withArea[i]!.area / Math.max(1, withArea[i - 1]!.area);
    if (gap > maxGap && gap > 2.4) {
      maxGap = gap;
      splitIdx = i;
    }
  }
  if (maxGap > 2.4 && splitIdx > 0) {
    const smallCluster = withArea.slice(0, splitIdx);
    const largeCluster = withArea.slice(splitIdx);
    if (largeCluster.length <= 6 && smallCluster.length >= largeCluster.length * 2) {
      filtered = smallCluster;
    } else if (smallCluster.length <= 6 && largeCluster.length >= smallCluster.length * 2) {
      filtered = largeCluster;
    } else {
      const smallMedian = smallCluster[Math.floor(smallCluster.length / 2)]!.area;
      const largeMedian = largeCluster[Math.floor(largeCluster.length / 2)]!.area;
      filtered = largeMedian > smallMedian * 1.8 ? largeCluster : smallCluster;
    }
  } else {
    const median = withArea[Math.floor(withArea.length / 2)]!.area;
    const minArea = Math.max(STORYBOARD_SHEET_MIN_PANEL_AREA * 0.35, median * 0.28);
    const maxArea = median * 2.8;
    const band = withArea.filter((item) => item.area >= minArea && item.area <= maxArea);
    if (band.length >= 4) filtered = band;
  }

  if (filtered.length >= 4) {
    return sortStoryboardSheetBoxesReadingOrder(filtered.map((item) => item.box));
  }
  return sortStoryboardSheetBoxesReadingOrder(withArea.map((item) => item.box));
}

export function resolveStoryboardSheetLayoutGridForPanelCount(
  panelCount: number,
  preferred?: StoryboardSheetLayoutGrid
): StoryboardSheetLayoutGrid {
  if (
    preferred &&
    preferred.cols * preferred.rows >= panelCount &&
    Math.abs(preferred.cols * preferred.rows - panelCount) <= 2
  ) {
    return preferred;
  }
  return suggestStoryboardSheetLayoutGrid(panelCount);
}

export function pickStoryboardSheetLayoutByAspect(
  width: number,
  height: number
): StoryboardSheetLayoutGrid {
  const aspect = width / Math.max(height, 1);
  let best: { cols: number; rows: number; score: number } | null = null;
  for (let cols = 2; cols <= 8; cols += 1) {
    for (let rows = 2; rows <= 8; rows += 1) {
      const cells = cols * rows;
      if (cells < 4 || cells > 40) continue;
      const gridAspect = cols / rows;
      const score = 1 / (1 + Math.abs(aspect - gridAspect));
      if (!best || score > best.score) {
        best = { cols, rows, score };
      }
    }
  }
  return best ? { cols: best.cols, rows: best.rows } : { cols: 4, rows: 4 };
}

export async function detectStoryboardSheetGridByUniformFit(
  src: string,
  layoutGrid?: StoryboardSheetLayoutGrid,
  cellCountHint?: number
): Promise<BoundingBox[]> {
  if (layoutGrid) {
    const cols = Math.max(1, Math.min(12, Math.round(layoutGrid.cols)));
    const rows = Math.max(1, Math.min(12, Math.round(layoutGrid.rows)));
    const maxCells = cols * rows;
    const cellCount =
      cellCountHint && cellCountHint > 0 ? Math.min(maxCells, cellCountHint) : maxCells;
    return buildLayoutSheetGridBoxes({ cols, rows }, cellCount);
  }

  const img = await loadSheetImageForGrid(src);
  if (!img) return [];
  const best = pickStoryboardSheetUniformGridLayout(img);
  if (best) {
    return buildLayoutSheetGridBoxes({ cols: best.cols, rows: best.rows }, best.cols * best.rows);
  }
  const aspectLayout = pickStoryboardSheetLayoutByAspect(img.width, img.height);
  return buildLayoutSheetGridBoxes(aspectLayout, aspectLayout.cols * aspectLayout.rows);
}

export function isUsableStoryboardSheetSplitDraftBoxes(boxes: BoundingBox[] | undefined): boolean {
  const list = boxes ?? [];
  if (!list.length) return false;
  return !isCollapsedStoryboardSheetVisionDetect(list);
}

function scoreStoryboardSheetDetectCandidate(
  boxes: BoundingBox[],
  expectedCellCount?: number,
  structure?: StoryboardSheetStructureAnalysis
): number {
  if (!boxes.length) return -1_000_000;
  if (isCollapsedStoryboardSheetVisionDetect(boxes)) return -100_000;
  const count = boxes.length;
  const areas = boxes.map((box) => boxArea(box)).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)] ?? 0;
  let score = 0;
  if (median < 8_000) score -= 40_000;
  else if (median >= STORYBOARD_SHEET_MIN_PANEL_AREA) score += 8_000;

  if (structure && count === structure.shotCount) score += 5_000;

  if (expectedCellCount && expectedCellCount > 0) {
    const diff = Math.abs(count - expectedCellCount);
    score += 10_000 - diff * 900;
    if (count > expectedCellCount * 2) score -= 50_000;
    if (count > expectedCellCount + 5) score -= 20_000;
    return score;
  }
  return score + count * 100;
}

function pickBestStoryboardSheetDetectCandidates(
  candidates: BoundingBox[][],
  expectedCellCount?: number,
  structure?: StoryboardSheetStructureAnalysis
): BoundingBox[] {
  const ranked = candidates
    .map((boxes) => boxes.filter((box) => boxArea(box) > 20 * 20))
    .filter((boxes) => boxes.length > 0)
    .sort(
      (a, b) =>
        scoreStoryboardSheetDetectCandidate(b, expectedCellCount, structure) -
        scoreStoryboardSheetDetectCandidate(a, expectedCellCount, structure)
    );
  return ranked[0] ?? [];
}

/** @internal exported for unit tests */
export function pickStoryboardSheetDetectCandidatesForExpectedCount(
  candidates: BoundingBox[][],
  expectedCellCount: number,
  structure?: StoryboardSheetStructureAnalysis
): BoundingBox[] {
  return pickBestStoryboardSheetDetectCandidates(candidates, expectedCellCount, structure);
}

export function buildStoryboardSheetGridShotLabelPrompt(
  cellCount: number,
  layout: StoryboardSheetLayoutGrid
): string {
  return `这是一张规整网格分镜拼图，共 ${cellCount} 格（${layout.cols} 列 × ${layout.rows} 行，从左到右、从上到下）。

请只读取每格顶部镜号条中的镜号（常见格式「121 | 4s」，取竖线左侧数字；不要时长、对白、动作描述）。

为每一格各返回一个 JSON 对象：label=镜号字符串，box_2d 可粗略框住该格顶部镜号条即可。
必须返回 ${cellCount} 项，顺序与阅读顺序一致。`;
}

async function detectStoryboardSheetPanelsByGrid(dataUrl: string): Promise<BoundingBox[]> {
  try {
    const boxes = await detectAutoGrid(dataUrl, { mode: 'auto', config: {} });
    return boxes.filter((box) => boxArea(box) > 20 * 20);
  } catch {
    return [];
  }
}

function mergeGridBoxesWithVisionLabels(
  gridBoxes: BoundingBox[],
  labelBoxes: BoundingBox[]
): BoundingBox[] {
  const sortedGrid = sortStoryboardSheetBoxesReadingOrder(gridBoxes);
  const sortedLabels = sortStoryboardSheetBoxesReadingOrder(labelBoxes);
  if (!sortedLabels.length) return sortedGrid;
  return sortedGrid.map((box, index) => {
    const labelBox = sortedLabels[index];
    const label = labelBox?.label?.trim() || box.label;
    return { ...box, label };
  });
}

function finalizeStoryboardSheetDetectBoxes(
  boxes: BoundingBox[],
  opts?: { skipVisualCrop?: boolean }
): BoundingBox[] {
  const deduped = dedupeBoxesByLabel(boxes);
  const quality = filterVisionBoxesByQuality(deduped);
  const base = quality.length ? quality : deduped;
  if (opts?.skipVisualCrop !== false) return base;
  return mapStoryboardBoxesToVisualCrop(base);
}

/** 整格框按像素内容收窄至插画区（用于网格识别后的二次精修） */
export async function refineStoryboardSheetDetectBoxesToIllustration(
  dataUrl: string,
  boxes: BoundingBox[]
): Promise<BoundingBox[]> {
  return refineStoryboardNormBoxesToIllustrationBounds(dataUrl, boxes);
}

/** @internal exported for unit tests */
export function finalizeStoryboardSheetDetectBoxesForTest(
  boxes: BoundingBox[],
  opts?: { skipVisualCrop?: boolean }
): BoundingBox[] {
  return finalizeStoryboardSheetDetectBoxes(boxes, opts);
}

export function normalizeStoryboardSheetStructureAnalysis(
  raw: {
    shotCount: number;
    cols: number;
    rows: number;
    shotNos: string[];
    emptyCellCount: number;
  } | null | undefined
): StoryboardSheetStructureAnalysis | null {
  if (!raw) return null;
  const cols = Math.max(1, Math.min(12, Math.round(raw.cols)));
  const rows = Math.max(1, Math.min(12, Math.round(raw.rows)));
  let shotNos = raw.shotNos
    .map((shot) => normalizeStoryboardShotNoInput(String(shot || '')))
    .filter(Boolean);
  let shotCount = Math.max(1, Math.min(40, Math.round(raw.shotCount)));
  if (shotNos.length > shotCount) shotNos = shotNos.slice(0, shotCount);
  if (shotNos.length >= Math.max(1, shotCount - 2)) {
    shotCount = Math.max(shotCount, shotNos.length);
    if (shotNos.length > shotCount) shotNos = shotNos.slice(0, shotCount);
  }
  if (cols * rows < shotCount) return null;
  if (shotNos.length < 1) {
    shotNos = Array.from({ length: shotCount }, (_, index) =>
      String(index + 1).padStart(3, '0')
    );
  }
  return {
    shotCount,
    cols,
    rows,
    shotNos,
    emptyCellCount: Math.max(0, Math.round(raw.emptyCellCount || 0)),
  };
}

export function buildStoryboardSheetStructureLayoutBoxes(
  structure: StoryboardSheetStructureAnalysis,
  contentBounds?: StoryboardSheetGridBounds
): BoundingBox[] {
  return labelStoryboardLayoutGridBoxes(
    buildLayoutSheetGridBoxes(
      { cols: structure.cols, rows: structure.rows },
      structure.shotCount,
      contentBounds
    ),
    structure.shotNos.slice(0, structure.shotCount)
  );
}

/** 结构已知时，过滤 auto grid 里顶栏小格/误检碎框 */
export function filterAutoGridBoxesForStructureLayout(
  boxes: BoundingBox[],
  structure: StoryboardSheetStructureAnalysis
): BoundingBox[] {
  const expectedCellArea = (1000 / structure.cols) * (1000 / structure.rows);
  const minArea = expectedCellArea * 0.32;
  const maxArea = expectedCellArea * 2.8;
  return sortStoryboardSheetBoxesReadingOrder(
    boxes.filter((box) => {
      const area = boxArea(box);
      return area >= minArea && area <= maxArea;
    })
  );
}

/** 结构分析已知行列/镜数时，仅用算法定位（格线 > 过滤 auto grid > 均匀网格） */
export async function resolveStoryboardSheetBoxesFromStructure(
  dataUrl: string,
  structure: StoryboardSheetStructureAnalysis,
  autoGridBoxes: BoundingBox[],
  expectedShotNos: string[]
): Promise<{ boxes: BoundingBox[]; method: string }> {
  const labels = structure.shotNos.slice(0, structure.shotCount);
  const labelBoxes = (source: BoundingBox[]) =>
    labelStoryboardLayoutGridBoxes(
      sortStoryboardSheetBoxesReadingOrder(source).slice(0, structure.shotCount),
      expectedShotNos.length >= structure.shotCount ? expectedShotNos : labels
    );

  const lineBoxes = await detectStoryboardGridBoxesForLayout(
    dataUrl,
    { cols: structure.cols, rows: structure.rows },
    structure.shotCount
  );
  if (lineBoxes.length >= structure.shotCount) {
    return { boxes: labelBoxes(lineBoxes), method: 'line_grid+structure' };
  }

  const filteredAuto = filterAutoGridBoxesForStructureLayout(autoGridBoxes, structure);
  const gridCells = structure.cols * structure.rows;
  if (
    filteredAuto.length >= structure.shotCount &&
    (filteredAuto.length >= gridCells - structure.emptyCellCount ||
      filteredAuto.length === structure.shotCount)
  ) {
    return { boxes: labelBoxes(filteredAuto), method: 'auto_grid+structure' };
  }

  return {
    boxes: buildStoryboardSheetStructureLayoutBoxes(structure),
    method: 'uniform_grid+structure',
  };
}

async function analyzeStoryboardSheetStructureForEstimate(
  dataUrl: string,
  textModel: string,
  timeoutMs: number,
  onStatus?: (message: string) => void
): Promise<StoryboardSheetStructureAnalysis | null> {
  try {
    onStatus?.('正在识别分镜结构…');
    const visionInput = await scaleStoryboardSheetForVisionDetect(dataUrl);
    const raw = await analyzeStoryboardSheetStructureInImage(visionInput, textModel, { timeoutMs });
    return normalizeStoryboardSheetStructureAnalysis(raw);
  } catch {
    return null;
  }
}

export async function estimateStoryboardSheetPanelCountFromImage(
  dataUrl: string,
  opts?: { hintCount?: number; textModel?: string; timeoutMs?: number; onDetectStatus?: (message: string) => void }
): Promise<StoryboardSheetPanelEstimate> {
  const hint =
    opts?.hintCount && opts.hintCount > 0 ? Math.min(40, Math.round(opts.hintCount)) : undefined;
  const timeoutMs = opts?.timeoutMs ?? STORYBOARD_SHEET_VISION_TIMEOUT_MS;
  const textModel = opts?.textModel ?? DEFAULT_MODEL_TEXT;
  const onStatus = opts?.onDetectStatus;

  const [structureAnalysis, rawAutoBoxes] = await Promise.all([
    analyzeStoryboardSheetStructureForEstimate(dataUrl, textModel, timeoutMs, onStatus),
    detectStoryboardSheetPanelsByGrid(dataUrl)
      .then((boxes) => boxes.filter((box) => boxArea(box) > 20 * 20))
      .catch(() => [] as BoundingBox[]),
  ]);
  const contentBounds = inferStoryboardSheetMainContentBounds(rawAutoBoxes) ?? undefined;

  if (structureAnalysis) {
    return {
      panelCount: structureAnalysis.shotCount,
      layoutGrid: { cols: structureAnalysis.cols, rows: structureAnalysis.rows },
      method: 'vision_structure',
      contentBounds: undefined,
      structureAnalysis,
    };
  }

  const panelCells = filterStoryboardAutoGridToPanelCells(rawAutoBoxes);
  const autoCount = panelCells.length;

  if (autoCount >= 4) {
    return {
      panelCount: autoCount,
      layoutGrid: resolveStoryboardSheetLayoutGridForPanelCount(autoCount),
      method: 'auto_grid',
      contentBounds,
    };
  }

  const img = await loadSheetImageForGrid(dataUrl);
  const uniform = img
    ? pickStoryboardSheetUniformGridLayout(img, { hintCount: hint, contentBounds })
    : null;
  if (uniform && uniform.score >= 0.04) {
    return {
      panelCount: uniform.cols * uniform.rows,
      layoutGrid: { cols: uniform.cols, rows: uniform.rows },
      method: 'uniform_grid',
      contentBounds,
    };
  }

  if (autoCount >= 1) {
    return {
      panelCount: autoCount,
      layoutGrid: resolveStoryboardSheetLayoutGridForPanelCount(autoCount),
      method: 'auto_grid_sparse',
      contentBounds,
    };
  }

  if (hint && hint >= 2) {
    return {
      panelCount: hint,
      layoutGrid: resolveStoryboardSheetLayoutGridForPanelCount(hint, uniform ?? undefined),
      method: 'hint_fallback',
      contentBounds,
    };
  }

  return {
    panelCount: 1,
    layoutGrid: { cols: 1, rows: 1 },
    method: 'fallback_single',
    contentBounds,
  };
}

export async function detectStoryboardSheetPanels(
  dataUrl: string,
  expectedShotNos: string[],
  textModel = DEFAULT_MODEL_TEXT,
  options?: StoryboardSheetVisionDetectOptions
): Promise<BoundingBox[]> {
  const structure = options?.structureAnalysis;
  const prompt =
    options?.customPrompt?.trim() ||
    buildStoryboardSheetVisionPrompt(expectedShotNos, structure);
  const assetId = String(options?.storyboardAssetId || '').trim();
  const timeoutMs = options?.timeoutMs ?? STORYBOARD_SHEET_VISION_TIMEOUT_MS;
  const expectedCellCount =
    structure?.shotCount ??
    (options?.panelCount && options.panelCount > 0
      ? options.panelCount
      : expectedShotNos.length > 0
        ? expectedShotNos.length
        : options?.layoutGrid
          ? options.layoutGrid.cols * options.layoutGrid.rows
          : undefined);
  let detectMethod = 'vision';
  let visionDetectScaled = false;

  /** 结构已由 Gemini 分析完毕：仅用格线/像素算法生成框，不再调视觉框选 */
  if (structure && structure.shotCount > 1) {
    detectMethod = 'structure_algo';
    try {
      options?.onDetectStatus?.('正在定位分镜格…');
      const autoGridBoxes = await detectStoryboardSheetPanelsByGrid(dataUrl);
      const resolved = await resolveStoryboardSheetBoxesFromStructure(
        dataUrl,
        structure,
        autoGridBoxes,
        expectedShotNos
      );
      let boxes = resolved.boxes;
      detectMethod = resolved.method;
      options?.onDetectStatus?.('正在整理切分框…');
      try {
        boxes = await refineStoryboardNormBoxesToIllustrationBounds(dataUrl, boxes);
      } catch {
        /* keep grid boxes */
      }
      if (assetId) {
        auditStoryboardTaskOutcome({
          kind: 'llm',
          ok: true,
          assetId,
          operation: 'vision_detect',
          message: `分镜表 · 识别 ${boxes.length} 个分镜格（${detectMethod}）`,
          level: 'info',
          detail: {
            expectedShots: expectedShotNos.length,
            boxCount: boxes.length,
            visionDetectScaled: false,
            detectMethod,
            collapsed: isCollapsedStoryboardSheetVisionDetect(boxes),
          },
        });
      }
      return boxes;
    } catch (error) {
      if (assetId) {
        auditStoryboardTaskOutcome({
          kind: 'llm',
          ok: false,
          assetId,
          operation: 'vision_detect',
          message: `分镜表 · 结构切分失败：${error instanceof Error ? error.message : String(error)}`,
          level: 'error',
        });
      }
      throw error;
    }
  }

  if (
    options?.skipVisionDetect &&
    options.layoutGrid &&
    expectedCellCount &&
    expectedCellCount > 1
  ) {
    detectMethod = 'layout_grid_fast';
    let boxes = buildStoryboardSheetLayoutGridDetectBoxes(
      options.layoutGrid,
      expectedCellCount,
      expectedShotNos,
      options.contentBounds
    );
    try {
      boxes = await refineStoryboardNormBoxesToIllustrationBounds(dataUrl, boxes);
    } catch {
      /* keep grid boxes */
    }
    if (assetId) {
      auditStoryboardTaskOutcome({
        kind: 'llm',
        ok: true,
        assetId,
        operation: 'vision_detect',
        message: `分镜表 · 识别 ${boxes.length} 个分镜格（${detectMethod}）`,
        level: 'info',
        detail: {
          expectedShots: expectedShotNos.length,
          boxCount: boxes.length,
          visionDetectScaled: false,
          detectMethod,
          collapsed: false,
        },
      });
    }
    return boxes;
  }

  try {
    options?.onDetectStatus?.('正在定位分镜格…');
    const [uniformGridBoxes, autoGridBoxes, visionInput] = await Promise.all([
      detectStoryboardSheetGridByUniformFit(dataUrl, options?.layoutGrid, expectedCellCount),
      detectStoryboardSheetPanelsByGrid(dataUrl),
      scaleStoryboardSheetForVisionDetect(dataUrl),
    ]);
    visionDetectScaled = visionInput !== dataUrl;

    const filteredAutoGrid = filterStoryboardAutoGridToPanelCells(autoGridBoxes);
    const autoCandidates =
      filteredAutoGrid.length >= 4 ? filteredAutoGrid : autoGridBoxes.filter((box) => boxArea(box) > 20 * 20);

    let visionBoxes: BoundingBox[] = [];
    try {
      visionBoxes = await detectObjectsInImage(visionInput, textModel, prompt, { timeoutMs });
    } catch {
      visionBoxes = [];
    }

    const visionFinal = finalizeStoryboardSheetDetectBoxes(visionBoxes, { skipVisualCrop: true });
    let boxes: BoundingBox[] = [];
    let detectMethod = 'vision';

    if (structure) {
      const resolved = await resolveStoryboardSheetBoxesFromStructure(
        dataUrl,
        structure,
        autoGridBoxes,
        visionFinal,
        expectedShotNos
      );
      boxes = resolved.boxes;
      detectMethod = resolved.method;
    } else {
      const structureLayoutBoxes: BoundingBox[] = [];
      const candidates = [autoCandidates, visionFinal, uniformGridBoxes];
      boxes = pickBestStoryboardSheetDetectCandidates(candidates, expectedCellCount, structure);
      if (boxes === autoCandidates && autoCandidates.length > 1) detectMethod = 'auto_grid';
      else if (boxes === uniformGridBoxes && uniformGridBoxes.length > 1) {
        detectMethod = options?.layoutGrid ? 'layout_grid' : 'uniform_fit';
      } else if (boxes === visionFinal && visionFinal.length > 1) detectMethod = 'vision';
    }

    if (!structure) {
      if (isCollapsedStoryboardSheetVisionDetect(boxes) && uniformGridBoxes.length > 1) {
        boxes = uniformGridBoxes;
        detectMethod = options?.layoutGrid ? 'layout_grid' : 'uniform_fit';
      } else if (isCollapsedStoryboardSheetVisionDetect(boxes) && autoCandidates.length > 1) {
        boxes = autoCandidates;
        detectMethod = 'auto_grid';
      } else if (boxes === uniformGridBoxes && uniformGridBoxes.length > 1) {
        detectMethod = options?.layoutGrid ? 'layout_grid' : 'uniform_fit';
      } else if (boxes === autoGridBoxes && autoGridBoxes.length > 1) {
        detectMethod = 'auto_grid';
      } else if (isCollapsedStoryboardSheetVisionDetect(boxes)) {
        const img = await loadSheetImageForGrid(dataUrl);
        if (img) {
          const aspectLayout = pickStoryboardSheetLayoutByAspect(img.width, img.height);
          const aspectBoxes = buildLayoutSheetGridBoxes(
            aspectLayout,
            aspectLayout.cols * aspectLayout.rows
          );
          if (aspectBoxes.length > 1) {
            boxes = aspectBoxes;
            detectMethod = 'aspect_grid';
          }
        }
      }
    }

    if (
      boxes.length > 1 &&
      (detectMethod !== 'vision' || isCollapsedStoryboardSheetVisionDetect(visionFinal))
    ) {
      const skipVisualCrop = true;
      const labelCellCount = expectedCellCount ?? boxes.length;
      if (storyboardSheetDetectHasExpectedLabels(expectedShotNos, labelCellCount)) {
        boxes = finalizeStoryboardSheetDetectBoxes(
          labelStoryboardLayoutGridBoxes(boxes.slice(0, labelCellCount), expectedShotNos),
          { skipVisualCrop }
        );
      } else {
        try {
          const layout =
            options?.layoutGrid ??
            (expectedCellCount
              ? computeStoryboardMosaicGrid(expectedCellCount)
              : computeStoryboardMosaicGrid(boxes.length));
          const labelPrompt = buildStoryboardSheetGridShotLabelPrompt(labelCellCount, layout);
          const labelBoxes = await detectObjectsInImage(visionInput, textModel, labelPrompt, {
            timeoutMs,
          });
          boxes = finalizeStoryboardSheetDetectBoxes(
            mergeGridBoxesWithVisionLabels(boxes.slice(0, labelCellCount), labelBoxes),
            { skipVisualCrop }
          );
        } catch {
          boxes = finalizeStoryboardSheetDetectBoxes(
            expectedCellCount ? boxes.slice(0, expectedCellCount) : boxes,
            { skipVisualCrop }
          );
        }
      }
    } else if (!isUsableStoryboardSheetSplitDraftBoxes(boxes) && uniformGridBoxes.length > 1) {
      detectMethod = options?.layoutGrid ? 'layout_grid' : 'uniform_fit';
      boxes = finalizeStoryboardSheetDetectBoxes(
        expectedCellCount
          ? uniformGridBoxes.slice(0, expectedCellCount)
          : uniformGridBoxes,
        { skipVisualCrop: true }
      );
    } else {
      boxes = finalizeStoryboardSheetDetectBoxes(
        expectedCellCount && boxes.length > expectedCellCount
          ? boxes.slice(0, expectedCellCount)
          : boxes,
        { skipVisualCrop: true }
      );
    }

    if (
      expectedCellCount &&
      boxes.length > expectedCellCount &&
      autoCandidates.length >= expectedCellCount &&
      scoreStoryboardSheetDetectCandidate(autoCandidates, expectedCellCount) >=
        scoreStoryboardSheetDetectCandidate(boxes, expectedCellCount) - 2000
    ) {
      boxes = sortStoryboardSheetBoxesReadingOrder(autoCandidates).slice(0, expectedCellCount);
      detectMethod = 'auto_grid';
    } else if (expectedCellCount && boxes.length > expectedCellCount) {
      boxes = sortStoryboardSheetBoxesReadingOrder(boxes).slice(0, expectedCellCount);
    } else if (
      expectedCellCount &&
      boxes.length < expectedCellCount &&
      autoCandidates.length >= expectedCellCount
    ) {
      boxes = sortStoryboardSheetBoxesReadingOrder(autoCandidates).slice(0, expectedCellCount);
      detectMethod = 'auto_grid';
    }

    if (boxes.length > 0) {
      options?.onDetectStatus?.('正在整理切分框…');
      try {
        boxes = await refineStoryboardNormBoxesToIllustrationBounds(dataUrl, boxes);
      } catch {
        /* keep boxes */
      }
    }

    if (assetId) {
      auditStoryboardTaskOutcome({
        kind: 'llm',
        ok: true,
        assetId,
        operation: 'vision_detect',
        message:
          boxes.length > 0
            ? `分镜表 · 识别 ${boxes.length} 个分镜格（${detectMethod}）`
            : '分镜表 · 视觉识别未找到分镜格',
        level: boxes.length > 0 ? 'info' : 'warn',
        detail: {
          expectedShots: expectedShotNos.length,
          boxCount: boxes.length,
          visionDetectScaled,
          detectMethod,
          collapsed: isCollapsedStoryboardSheetVisionDetect(boxes),
        },
      });
    }
    return boxes;
  } catch (error) {
    if (assetId) {
      auditStoryboardTaskOutcome({
        kind: 'llm',
        ok: false,
        assetId,
        operation: 'vision_detect',
        message: `分镜表 · 视觉识别失败：${error instanceof Error ? error.message : String(error)}`,
        level: 'error',
      });
    }
    throw error;
  }
}

export function visionLabelToShotNo(label: string): string {
  const text = String(label || '').trim();
  if (!text) return '';
  const inferred = inferShotNoFromMixedText(text);
  if (inferred) return inferred;
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
  if (!expectedShotNos.length) return true;
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

export function buildStoryboardSheetLayoutGridDetectBoxes(
  layoutGrid: StoryboardSheetLayoutGrid,
  cellCount: number,
  expectedShotNos: string[],
  contentBounds?: StoryboardSheetGridBounds
): BoundingBox[] {
  return labelStoryboardLayoutGridBoxes(
    buildLayoutSheetGridBoxes(layoutGrid, cellCount, contentBounds),
    expectedShotNos
  );
}

function storyboardSheetDetectHasExpectedLabels(
  expectedShotNos: string[],
  cellCount: number
): boolean {
  return expectedShotNos.map((shot) => shot.trim()).filter(Boolean).length >= cellCount;
}

export async function detectStoryboardSheetPanelsFromKnownLayout(
  dataUrl: string,
  expectedShotNos: string[],
  layoutGrid: StoryboardSheetLayoutGrid,
  cellCount: number
): Promise<BoundingBox[]> {
  const boxes = buildStoryboardSheetLayoutGridDetectBoxes(layoutGrid, cellCount, expectedShotNos);
  return refineStoryboardNormBoxesToIllustrationBounds(dataUrl, boxes);
}

export function buildLayoutSheetGridBoxes(
  layout: StoryboardSheetLayoutGrid,
  cellCount: number,
  contentBounds?: StoryboardSheetGridBounds
): BoundingBox[] {
  const cols = Math.max(1, Math.min(12, Math.round(layout.cols)));
  const gridRows = Math.max(1, Math.min(12, Math.round(layout.rows)));
  const margin = 4;
  const x0 = contentBounds?.xmin ?? 0;
  const y0 = contentBounds?.ymin ?? 0;
  const x1 = contentBounds?.xmax ?? 1000;
  const y1 = contentBounds?.ymax ?? 1000;
  const spanW = Math.max(1, x1 - x0);
  const spanH = Math.max(1, y1 - y0);
  const cellW = spanW / cols;
  const cellH = spanH / gridRows;
  const boxes: BoundingBox[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    const col = index % cols;
    const rowIdx = Math.floor(index / cols);
    if (rowIdx >= gridRows) break;
    boxes.push({
      id: `grid-${index}`,
      label: String(index + 1),
      xmin: Math.max(0, Math.round(x0 + col * cellW + margin)),
      ymin: Math.max(0, Math.round(y0 + rowIdx * cellH + margin)),
      xmax: Math.min(1000, Math.round(x0 + (col + 1) * cellW - margin)),
      ymax: Math.min(1000, Math.round(y0 + (rowIdx + 1) * cellH - margin)),
    });
  }
  return boxes;
}

/** 布局网格切分框按镜号顺序打 label，避免 1/2/3 与 001/002 匹配失败 */
export function labelStoryboardLayoutGridBoxes(
  boxes: BoundingBox[],
  expectedShotNos: string[]
): BoundingBox[] {
  return boxes.map((box, index) => ({
    ...box,
    label: expectedShotNos[index]?.trim() || box.label,
  }));
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
  warnPrefix: string,
  opts?: { trimCrops?: boolean }
): Promise<StoryboardSheetVisionSplitResult> {
  if (!rows.length) return { matches: [], unmatchedLabels: [] };

  const rawCrops = await cropBoxes(
    dataUrl,
    boxes,
    boxes.map((_, index) => index),
    2
  );
  const crops =
    opts?.trimCrops === false ? rawCrops : await trimVisionSplitCrops(rawCrops);

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
      warn: '视觉识别未找到分镜格，请检查拼图分隔线是否清晰，或填写行列布局后重切',
    };
  }

  return splitStoryboardSheetFromBoxes(dataUrl, rows, boxes, options);
}
