import type { CustomAppModule, WorkflowAsset } from '../types';
import { presetUsesHostBundleProcessor } from './capabilityProcessors/imageProcessProcessors';

/** 单张文字资产正文上限（字符），防止工作区 JSON 过大 */
export const WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS = 32_000;

export function isWorkflowTextAsset(a: WorkflowAsset): boolean {
  return a.assetKind === 'text';
}

export function clampWorkflowTextBody(raw: string): string {
  if (raw.length <= WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS) return raw;
  return raw.slice(0, WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS);
}

/** 文字卡拖入能力时拼接为 inputText */
export function workflowAssetToInputText(a: WorkflowAsset): string {
  const t = (a.textTitle || '').trim();
  const displayKey = (a.displayKey || 'original').trim() || 'original';
  const displayBody =
    displayKey === 'original'
      ? (a.textBody || '')
      : ((a.textResults || {})[displayKey] ?? a.textBody ?? '');
  const b = String(displayBody).trim();
  if (t && b) return `${t}\n\n${b}`;
  return b || t;
}

/**
 * 文字资产当前显示版本是否应按 **文本** 参与拖放（底部栏草稿、队列 `inputText`、微调弹窗等）。
 * 当 `displayKey` 指向 `results` 中的图（如文生图结果）时为 false，应按 **当前图**（`getAssetDisplayImage`）处理。
 */
export function workflowAssetCurrentDisplayIsTextChannel(a: WorkflowAsset): boolean {
  if (!isWorkflowTextAsset(a)) return false;
  const dk = (a.displayKey || 'original').trim() || 'original';
  if (dk === 'original') return true;
  const raster = String((a.results || {})[dk] ?? '').trim();
  return !raster;
}

/** 大图预览是否应按位图处理（标注 / SAM / overlay 写回 / @当前画面 等） */
export function workflowAssetLightboxRasterEligible(a: WorkflowAsset, displayImage: string): boolean {
  if (isWorkflowTextAsset(a) && workflowAssetCurrentDisplayIsTextChannel(a)) return false;
  return Boolean(String(displayImage || '').trim());
}

/** 文字卡可拖入：文生文、文生图 */
export function workflowPresetAcceptsTextCardDrag(mod: CustomAppModule): boolean {
  return mod.category === 'text_to_text' || mod.category === 'text_to_image';
}

function hasAnyTextPayload(asset: WorkflowAsset): boolean {
  if ((asset.textBody || '').trim()) return true;
  const textResults = asset.textResults || {};
  return Object.values(textResults).some((v) => String(v || '').trim() !== '');
}

function hasAnyImagePayload(asset: WorkflowAsset): boolean {
  if (String(asset.original || '').trim()) return true;
  if (asset.displayKey && asset.displayKey !== 'original') {
    const curr = String((asset.results || {})[asset.displayKey] || '').trim();
    if (curr) return true;
  }
  const results = asset.results || {};
  if (Object.values(results).some((v) => String(v || '').trim() !== '')) return true;
  if ((asset.cutImageGroup || []).some((it) => typeof it === 'string' && it.trim() !== '')) return true;
  return false;
}

/** 根资产拖入某预设时是否允许（按输入格式匹配资产类型） */
export function workflowAssetAllowedForCapabilityDrop(asset: WorkflowAsset, mod: CustomAppModule): boolean {
  if (presetUsesHostBundleProcessor(mod)) {
    return hasAnyImagePayload(asset) || hasAnyTextPayload(asset);
  }
  if (mod.category === 'text_to_text' || mod.category === 'text_to_image') {
    return hasAnyTextPayload(asset);
  }
  if (mod.category === 'generate_video') {
    return hasAnyImagePayload(asset) || hasAnyTextPayload(asset);
  }
  if (mod.category === 'image_process' || mod.category === 'image_to_image' || mod.category === 'image_to_text' || mod.category === 'generate_3d') {
    return hasAnyImagePayload(asset);
  }
  return false;
}

export function workflowTextAssetOutlineLabel(a: WorkflowAsset): string {
  const t = a.textTitle?.trim();
  if (t) return t.length > 32 ? `${t.slice(0, 32)}…` : t;
  const b = a.textBody?.trim();
  if (b) {
    const line = b.split(/\r?\n/).find((x) => x.trim()) ?? b;
    const s = line.trim().slice(0, 24);
    return s.length < line.trim().length ? `${s}…` : s || '文字';
  }
  return '文字';
}

function escapeXmlForSvgText(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 正文：单行内字符数、总行数；超出在末行末字加「…」 */
function splitComposerThumbBodyLines(bodyRaw: string, maxLines: number, charsPerLine: number): string[] {
  const t = String(bodyRaw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
  const base = t || '（空白）';
  const maxChars = maxLines * charsPerLine;
  const overflow = base.length > maxChars;
  const core = overflow ? base.slice(0, maxChars - 1) : base;
  const lines: string[] = [];
  for (let i = 0; i < core.length && lines.length < maxLines; i += charsPerLine) {
    lines.push(core.slice(i, i + charsPerLine));
  }
  if (overflow && lines.length > 0) {
    const last = lines[lines.length - 1]!;
    lines[lines.length - 1] =
      last.length >= charsPerLine ? `${last.slice(0, charsPerLine - 1)}…` : `${last}…`;
  }
  return lines;
}

function splitTitleForThumb(titleRaw: string, charsPerLine: number): { line1: string; line2: string | null } {
  const s = (titleRaw || '').trim() || '文本资产';
  if (s.length <= charsPerLine) return { line1: s, line2: null };
  const line1 = s.slice(0, charsPerLine);
  const rest = s.slice(charsPerLine);
  if (rest.length <= charsPerLine) return { line1, line2: rest };
  return { line1, line2: `${rest.slice(0, charsPerLine - 1)}…` };
}

/**
 * 能力集合「选择资产」面板 / 资产节点预览用缩略图（data URL SVG）。
 * 相对全屏 lightbox 用更小 viewBox、更大字号，便于格子内阅读；正文按字符截断。
 */
export function buildComposerTextAssetThumbDataUrl(titleRaw: string, bodyRaw: string): string {
  const TITLE_CHARS = 16;
  const BODY_LINES = 7;
  const BODY_CHARS_PER_LINE = 13;
  const { line1, line2 } = splitTitleForThumb(titleRaw, TITLE_CHARS);
  const t1 = escapeXmlForSvgText(line1);
  const t2 = line2 != null ? escapeXmlForSvgText(line2) : null;
  const bodyLines = splitComposerThumbBodyLines(bodyRaw, BODY_LINES, BODY_CHARS_PER_LINE).map(escapeXmlForSvgText);
  const lineH = 28;
  const title1Y = 38;
  const title2Y = 66;
  const bodyStartY = t2 != null ? 94 : 72;
  const title2Svg = t2
    ? `<text x="18" y="${title2Y}" fill="#f8fafc" font-size="22" font-weight="700" font-family="ui-sans-serif,system-ui,sans-serif">${t2}</text>`
    : '';
  const lineSvg = bodyLines
    .map(
      (line, i) =>
        `<text x="18" y="${bodyStartY + i * lineH}" fill="#cbd5e1" font-size="20" font-family="ui-sans-serif,system-ui,sans-serif">${line}</text>`
    )
    .join('');
  const svgH = 320;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="${svgH}" viewBox="0 0 320 ${svgH}">
<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#0f172a"/>
    <stop offset="100%" stop-color="#1e293b"/>
  </linearGradient>
</defs>
<rect width="320" height="${svgH}" rx="20" fill="url(#g)"/>
<rect x="10" y="10" width="300" height="${svgH - 20}" rx="16" fill="#0b1222" stroke="#334155" stroke-width="1.5"/>
<text x="18" y="22" fill="#64748b" font-size="12" font-weight="600" font-family="ui-sans-serif,system-ui,sans-serif">文字资产</text>
<text x="18" y="${title1Y}" fill="#38bdf8" font-size="22" font-weight="700" font-family="ui-sans-serif,system-ui,sans-serif">${t1}</text>
${title2Svg}
${lineSvg}
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
