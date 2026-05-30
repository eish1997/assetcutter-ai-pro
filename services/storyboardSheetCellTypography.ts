import {
  STORYBOARD_SHEET_SKETCH_TEXT_BODY,
  STORYBOARD_SHEET_SKETCH_TEXT_DIALOGUE,
  STORYBOARD_SHEET_SKETCH_TEXT_HEADER,
  storyboardSheetCanvasFont,
} from './storyboardSheetSketchStyle';

export type SheetCellTextMeta = {
  headerLine: string;
  visualLine: string;
  dialogueLine: string;
  fieldLines?: { label: string; value: string }[];
  compactLayout?: {
    headerLine: string;
    metaLine: string;
    description: string;
    extraLines: Array<string | { text: string; dialogue?: boolean }>;
  };
};

function isSheetDialogueLikeText(text: string): boolean {
  const t = text.trim();
  return /^(对白|旁白|台词)[：:]/i.test(t);
}

function sheetPanelExtraText(line: string | { text: string; dialogue?: boolean }): string {
  return typeof line === 'string' ? line : line.text;
}

function sheetPanelExtraIsDialogue(line: string | { text: string; dialogue?: boolean }): boolean {
  if (typeof line === 'string') return isSheetDialogueLikeText(line);
  return Boolean(line.dialogue) || isSheetDialogueLikeText(line.text);
}

export function sheetPanelUsesCompactFooter(meta: SheetCellTextMeta): boolean {
  if (meta.compactLayout) return true;
  const segs = sheetPanelCompactFooterSegments(meta);
  return Boolean(segs.metaLine || segs.description || segs.extraLines.length);
}

function resolveSheetPanelHeaderText(meta: SheetCellTextMeta, headerFallback: string): string {
  return meta.compactLayout?.headerLine || meta.headerLine || headerFallback;
}

export function sheetPanelCompactFooterSegments(meta: SheetCellTextMeta): {
  metaLine: string;
  description: string;
  extraLines: Array<string | { text: string; dialogue?: boolean }>;
} {
  if (meta.compactLayout) {
    return {
      metaLine: meta.compactLayout.metaLine,
      description: meta.compactLayout.description,
      extraLines: meta.compactLayout.extraLines,
    };
  }
  const displayLines = sheetPanelFieldLinesForDisplay(meta);
  return {
    metaLine: '',
    description: displayLines.find((l) => /画面|内容|描述|原文/i.test(l.label))?.value ?? meta.visualLine,
    extraLines: displayLines
      .filter((l) => !/画面|内容|描述|原文/i.test(l.label))
      .map((l) => l.value),
  };
}

function countWrappedLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): number {
  if (!text.trim()) return 0;
  return wrapSheetCanvasTextLines(ctx, text, maxWidth).length;
}

function countCompactFooterLines(
  ctx: CanvasRenderingContext2D,
  meta: SheetCellTextMeta,
  innerW: number
): number {
  const { metaLine, description, extraLines } = sheetPanelCompactFooterSegments(meta);
  let count = 0;
  count += countWrappedLines(ctx, metaLine, innerW);
  count += countWrappedLines(ctx, description, innerW);
  if (extraLines.length <= 1) {
    for (const line of extraLines) count += countWrappedLines(ctx, sheetPanelExtraText(line), innerW);
    return count;
  }
  const gap = Math.max(4, Math.round(innerW * 0.04));
  const colW = Math.max(24, Math.floor((innerW - gap) / 2));
  for (let i = 0; i < extraLines.length; i += 2) {
    const left = sheetPanelExtraText(extraLines[i]!);
    const right = extraLines[i + 1] ? sheetPanelExtraText(extraLines[i + 1]!) : undefined;
    if (right) {
      count += Math.max(
        countWrappedLines(ctx, left, colW),
        countWrappedLines(ctx, right, colW)
      );
    } else {
      count += countWrappedLines(ctx, left, innerW);
    }
  }
  return count;
}

export function sheetPanelFieldLinesForDisplay(
  meta: SheetCellTextMeta
): { label: string; value: string }[] {
  if (meta.fieldLines?.length) return meta.fieldLines;
  const lines: { label: string; value: string }[] = [];
  if (meta.visualLine.trim()) {
    lines.push({ label: '画面', value: meta.visualLine.trim() });
  }
  if (sheetPanelShowsDialogue(meta.dialogueLine)) {
    lines.push({ label: '对白', value: meta.dialogueLine.trim() });
  }
  return lines;
}

export function sheetPanelShowsDialogue(dialogueLine: string): boolean {
  const t = dialogueLine.trim();
  return !!t && t !== '-' && t !== '—' && t !== '–' && t !== '无';
}

export function estimateSheetCellTextDensity(meta: SheetCellTextMeta): number {
  const header = meta.compactLayout?.headerLine || meta.headerLine || '';
  const { metaLine, description, extraLines } = sheetPanelCompactFooterSegments(meta);
  return (
    header.length +
    metaLine.length +
    description.length +
    extraLines.reduce((sum, line) => sum + sheetPanelExtraText(line).length, 0)
  );
}

export type SheetCellLayoutInput = {
  cellW: number;
  cellH: number;
  canvasWidth?: number;
};

export type SheetCellTypography = {
  headerSize: number;
  bodySize: number;
  pad: number;
  lineH: number;
  showDialogue: boolean;
};

type SheetCellTextMetrics = Pick<SheetCellTypography, 'headerSize' | 'bodySize' | 'pad' | 'lineH'>;

export function wrapSheetCanvasTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    let chunk = '';
    for (const ch of para) {
      const next = chunk + ch;
      if (ctx.measureText(next).width > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch.trimStart();
      } else {
        chunk = next;
      }
    }
    if (chunk) lines.push(chunk);
  }
  return lines;
}

export function measureSheetCellTextBlock(
  ctx: CanvasRenderingContext2D,
  meta: SheetCellTextMeta,
  plan: SheetCellTextMetrics,
  cellW: number,
  headerFallback: string
): { headerBlockH: number; footerBlockH: number } {
  const innerW = cellW - plan.pad * 2;
  const headerText = resolveSheetPanelHeaderText(meta, headerFallback);

  ctx.font = storyboardSheetCanvasFont(500, plan.headerSize);
  const headerLineH = Math.round(plan.headerSize * 1.05);
  const headerLines = wrapSheetCanvasTextLines(ctx, headerText, innerW);
  const headerBlockH = headerLines.length * headerLineH + plan.pad;

  ctx.font = storyboardSheetCanvasFont(400, plan.bodySize);
  const footerLineCount = sheetPanelUsesCompactFooter(meta)
    ? countCompactFooterLines(ctx, meta, innerW)
    : (() => {
        const displayLines = sheetPanelFieldLinesForDisplay(meta);
        let count = 0;
        if (displayLines.length) {
          for (const line of displayLines) {
            count += wrapSheetCanvasTextLines(ctx, `${line.label}：${line.value}`, innerW).length;
          }
          return count;
        }
        count += wrapSheetCanvasTextLines(ctx, meta.visualLine || '（无画面描述）', innerW).length;
        if (sheetPanelShowsDialogue(meta.dialogueLine)) {
          count += wrapSheetCanvasTextLines(ctx, `对白：${meta.dialogueLine}`, innerW).length;
        }
        return count;
      })();
  const footerBlockH =
    footerLineCount * plan.lineH + Math.max(1, Math.round(plan.pad * 0.5));

  return { headerBlockH, footerBlockH };
}

function buildTypographyFromSizes(
  bounds: ReturnType<typeof resolveSheetCellFontBounds>,
  headerSize: number,
  bodySize: number,
  anyDialogue: boolean
): SheetCellTypography {
  return {
    headerSize,
    bodySize,
    pad: bounds.pad,
    lineH: Math.round(bodySize * 1.26),
    showDialogue: anyDialogue,
  };
}

function metaFitsInCell(
  ctx: CanvasRenderingContext2D,
  meta: SheetCellTextMeta,
  plan: SheetCellTypography,
  cellW: number,
  cellH: number,
  minImageH: number
): boolean {
  const { headerBlockH, footerBlockH } = measureSheetCellTextBlock(
    ctx,
    meta,
    plan,
    cellW,
    meta.headerLine || ''
  );
  return headerBlockH + footerBlockH + minImageH <= cellH;
}

/** 整组拼图统一字号：完整文本换行，取能容纳全部镜头的最小字号 */
export function planStoryboardSheetGroupTypography(
  ctx: CanvasRenderingContext2D,
  metas: SheetCellTextMeta[],
  layout: SheetCellLayoutInput
): SheetCellTypography {
  const bounds = resolveSheetCellFontBounds(layout);
  const anyDialogue = metas.some((meta) => {
    const { extraLines, description } = sheetPanelCompactFooterSegments(meta);
    return (
      sheetPanelShowsDialogue(meta.dialogueLine) ||
      isSheetDialogueLikeText(description) ||
      extraLines.some((line) => sheetPanelExtraIsDialogue(line))
    );
  });
  const minImageH = Math.max(20, Math.round(layout.cellW * 0.1));

  if (!metas.length) {
    return buildTypographyFromSizes(bounds, bounds.minHeader, bounds.minBody, false);
  }

  for (let bodySize = bounds.maxBody; bodySize >= bounds.minBody; bodySize -= 1) {
    const headerSize = Math.min(bounds.maxHeader, bodySize + 1);
    const plan = buildTypographyFromSizes(bounds, headerSize, bodySize, anyDialogue);
    const allFit = metas.every((meta) => metaFitsInCell(ctx, meta, plan, layout.cellW, layout.cellH, minImageH));
    if (allFit) return plan;
  }

  return buildTypographyFromSizes(bounds, bounds.minHeader, bounds.minBody, anyDialogue);
}

/** DOM 整组统一字号（与 Canvas 组排版一致） */
export function resolveStoryboardSheetGroupFontSize(
  metas: SheetCellTextMeta[],
  canvasWidth?: number,
  cellW = 280
): { fontSizePx: number; headerSizePx: number; anyDialogue: boolean } {
  if (typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      const plan = planStoryboardSheetGroupTypography(ctx, metas, {
        cellW,
        cellH: Math.round(cellW * 0.85),
        canvasWidth,
      });
      return {
        fontSizePx: plan.bodySize,
        headerSizePx: plan.headerSize,
        anyDialogue: plan.showDialogue,
      };
    }
  }
  const sizes = metas.map((meta) => resolveStoryboardSheetCellFontSize(meta, canvasWidth));
  return {
    fontSizePx: Math.min(...sizes.map((s) => s.fontSizePx)),
    headerSizePx: Math.min(...sizes.map((s) => s.fontSizePx)) + 1,
    anyDialogue: sizes.some((s) => s.showDialogue),
  };
}

export function resolveSheetCellFontBounds(layout: SheetCellLayoutInput) {
  const root = layout.canvasWidth ?? Math.max(layout.cellW, 960);
  const scale = root / 960;
  const pad = Math.max(2, Math.round(3 * scale));
  return {
    pad,
    maxHeader: Math.max(8, Math.min(Math.round(root * 0.013), Math.round(layout.cellH * 0.055))),
    maxBody: Math.max(7, Math.min(Math.round(root * 0.011), Math.round(layout.cellH * 0.048))),
    minHeader: 5,
    minBody: 4,
  };
}

/** DOM 按信息密度估算字号 */
export function resolveStoryboardSheetCellFontSize(
  meta: SheetCellTextMeta,
  canvasWidth?: number
): { fontSizePx: number; showDialogue: boolean } {
  const root = canvasWidth && canvasWidth > 0 ? canvasWidth : 960;
  const density = estimateSheetCellTextDensity(meta);
  const showDialogue = sheetPanelShowsDialogue(meta.dialogueLine);
  const refChars = Math.max(28, root / 22);
  const baseMax = Math.max(8, Math.min(14, Math.round(root * 0.011)));

  let fontSize = baseMax;
  if (density > refChars * 0.85) {
    fontSize = Math.round(baseMax * Math.sqrt(refChars / density));
  }
  if (density > refChars * 1.8) {
    fontSize = Math.round(baseMax * (refChars / density) * 1.15);
  }
  fontSize = Math.max(5, Math.min(baseMax, fontSize));

  return { fontSizePx: fontSize, showDialogue };
}

export function planStoryboardSheetCellTypography(
  ctx: CanvasRenderingContext2D,
  meta: SheetCellTextMeta,
  layout: SheetCellLayoutInput
): SheetCellTypography {
  return planStoryboardSheetGroupTypography(ctx, [meta], layout);
}

export function drawPlannedSheetCellText(
  ctx: CanvasRenderingContext2D,
  meta: SheetCellTextMeta,
  plan: SheetCellTypography,
  x: number,
  y: number,
  w: number,
  textStartY: number,
  headerFallback: string
): void {
  const innerW = w - plan.pad * 2;
  const headerText = resolveSheetPanelHeaderText(meta, headerFallback);
  const headerLineH = Math.round(plan.headerSize * 1.05);

  ctx.font = storyboardSheetCanvasFont(500, plan.headerSize);
  ctx.fillStyle = STORYBOARD_SHEET_SKETCH_TEXT_HEADER;
  const headerLines = wrapSheetCanvasTextLines(ctx, headerText, innerW);
  let hy = y + plan.pad;
  for (const line of headerLines) {
    ctx.fillText(line, x + plan.pad, hy + plan.headerSize);
    hy += headerLineH;
  }

  const { metaLine, description, extraLines } = sheetPanelCompactFooterSegments(meta);
  ctx.font = storyboardSheetCanvasFont(400, plan.bodySize);
  let fy = textStartY;

  const drawBodyLine = (text: string, dialogue = false) => {
    if (!text.trim()) return;
    ctx.fillStyle = dialogue
      ? STORYBOARD_SHEET_SKETCH_TEXT_DIALOGUE
      : STORYBOARD_SHEET_SKETCH_TEXT_BODY;
    for (const line of wrapSheetCanvasTextLines(ctx, text, innerW)) {
      ctx.fillText(line, x + plan.pad, fy + plan.bodySize);
      fy += plan.lineH;
    }
  };

  if (sheetPanelUsesCompactFooter(meta)) {
    drawBodyLine(metaLine, false);
    drawBodyLine(description, isSheetDialogueLikeText(description));
    if (extraLines.length <= 1) {
      for (const line of extraLines) {
        drawBodyLine(sheetPanelExtraText(line), sheetPanelExtraIsDialogue(line));
      }
      return;
    }
    const gap = Math.max(4, Math.round(innerW * 0.04));
    const colW = Math.max(24, Math.floor((innerW - gap) / 2));
    for (let i = 0; i < extraLines.length; i += 2) {
      const leftEntry = extraLines[i]!;
      const rightEntry = extraLines[i + 1];
      const left = sheetPanelExtraText(leftEntry);
      const right = rightEntry ? sheetPanelExtraText(rightEntry) : undefined;
      const leftLines = wrapSheetCanvasTextLines(ctx, left, colW);
      const rightLines = right ? wrapSheetCanvasTextLines(ctx, right, colW) : [];
      const rows = Math.max(leftLines.length, rightLines.length);
      for (let r = 0; r < rows; r += 1) {
        if (leftLines[r]) {
          ctx.fillStyle = sheetPanelExtraIsDialogue(leftEntry)
            ? STORYBOARD_SHEET_SKETCH_TEXT_DIALOGUE
            : STORYBOARD_SHEET_SKETCH_TEXT_BODY;
          ctx.fillText(leftLines[r]!, x + plan.pad, fy + plan.bodySize);
        }
        if (right && rightLines[r]) {
          ctx.fillStyle = sheetPanelExtraIsDialogue(rightEntry!)
            ? STORYBOARD_SHEET_SKETCH_TEXT_DIALOGUE
            : STORYBOARD_SHEET_SKETCH_TEXT_BODY;
          ctx.fillText(rightLines[r]!, x + plan.pad + colW + gap, fy + plan.bodySize);
        }
        fy += plan.lineH;
      }
    }
    return;
  }

  const displayLines = sheetPanelFieldLinesForDisplay(meta);
  if (displayLines.length) {
    for (const line of displayLines) {
      drawBodyLine(`${line.label}：${line.value}`, /对白|旁白|台词/i.test(line.label));
    }
    return;
  }

  drawBodyLine(meta.visualLine || '（无画面描述）', false);
  if (sheetPanelShowsDialogue(meta.dialogueLine)) {
    drawBodyLine(`对白：${meta.dialogueLine}`, true);
  }
}
