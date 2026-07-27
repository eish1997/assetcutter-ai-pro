import type { CustomAppModule, WorkflowAsset } from '../types';
import { presetUsesHostBundleProcessor } from './capabilityProcessors/imageProcessProcessors';
import {
  WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS,
  clampWorkflowTextBody,
} from './workflowTextLimits';
import { safeSvgDataUrl } from './svgDataUrl';

export { WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS, clampWorkflowTextBody } from './workflowTextLimits';

export function isWorkflowTextAsset(a: WorkflowAsset): boolean {
  return a.assetKind === 'text';
}

/** 显示态：displayKey 指向的槽模态（assetKind 仅表出生壳） */
export type WorkflowDisplaySlotModality = 'text' | 'image' | 'video' | 'model' | 'empty';

export type WorkflowDisplaySlot = {
  displayKey: string;
  modality: WorkflowDisplaySlotModality;
  imageSrc?: string;
  text?: string;
  companionKey?: string;
};

function hasRasterPayloadAtKey(asset: WorkflowAsset, key: string): boolean {
  const k = String(key || '').trim() || 'original';
  if (k === 'original') {
    return Boolean(
      String(asset.original || '').trim() ||
        String(asset.originalCompanionKey || '').trim() ||
        String(asset.originalObjectKey || '').trim()
    );
  }
  return Boolean(
    String((asset.results || {})[k] ?? '').trim() ||
      String((asset.resultsCompanionKeys || {})[k] || '').trim() ||
      String((asset.resultsObjectKeys || {})[k] || '').trim()
  );
}

/**
 * displayKey 指向空槽时，回退到仍有载荷的槽（原图优先，再 resultOrder）。
 * 用于 gaps 清键后避免「角标 2 + 暗空卡」假丢资产。
 */
export function healWorkflowAssetDisplayKeyIfEmpty(asset: WorkflowAsset): WorkflowAsset {
  if (isWorkflowTextAsset(asset)) {
    const slot = resolveWorkflowDisplaySlot(asset);
    if (slot.modality !== 'empty') return asset;
    if (hasAnyTextPayload(asset) && String(asset.displayKey || '') !== 'original') {
      return { ...asset, displayKey: 'original' };
    }
    return asset;
  }
  const slot = resolveWorkflowDisplaySlot(asset);
  if (slot.modality !== 'empty') return asset;
  if (hasRasterPayloadAtKey(asset, 'original')) {
    if (String(asset.displayKey || 'original') === 'original') return asset;
    return { ...asset, displayKey: 'original' };
  }
  const order =
    Array.isArray(asset.resultOrder) && asset.resultOrder.length > 0
      ? asset.resultOrder
      : Object.keys(asset.results || {});
  for (const key of order) {
    const stepId = String(key || '').trim();
    if (!stepId || !hasRasterPayloadAtKey(asset, stepId)) continue;
    if (String(asset.displayKey || '') === stepId) return asset;
    return { ...asset, displayKey: stepId };
  }
  return asset;
}

/** 3D 导入用的 SVG「本地预览」占位，不算真实位图预览 */
export function isWorkflowModelSvgPlaceholderSrc(src: string | undefined | null): boolean {
  const s = String(src || '').trim();
  if (!s) return false;
  return /^data:image\/svg\+xml/i.test(s);
}

/**
 * 按 displayKey 解析当前输出槽。
 * 硬规则：同一 key 不可双读 — 有 results[k] 则为图/视频槽；否则才读 textResults[k]。
 */
export function resolveWorkflowDisplaySlot(asset: WorkflowAsset): WorkflowDisplaySlot {
  const displayKey = String(asset.displayKey || 'original').trim() || 'original';

  if (displayKey === 'original') {
    if (isWorkflowTextAsset(asset)) {
      const text = String(asset.textBody || '').trim();
      return {
        displayKey,
        modality: text || String(asset.textTitle || '').trim() ? 'text' : 'empty',
        ...(text ? { text } : {}),
      };
    }
    const imageSrc = String(asset.original || '').trim();
    const companionKey = String(asset.originalCompanionKey || '').trim();
    const objectKey = String(asset.originalObjectKey || '').trim();
    if (imageSrc || companionKey || objectKey) {
      return {
        displayKey,
        modality: 'image',
        ...(imageSrc ? { imageSrc } : {}),
        ...(companionKey ? { companionKey } : {}),
      };
    }
    return { displayKey, modality: 'empty' };
  }

  const raster = String((asset.results || {})[displayKey] ?? '').trim();
  const mediaKind = asset.resultMeta?.[displayKey]?.mediaKind;
  const resultCompanionKey = String((asset.resultsCompanionKeys || {})[displayKey] || '').trim();
  const resultObjectKey = String((asset.resultsObjectKeys || {})[displayKey] || '').trim();

  if (raster || resultCompanionKey || resultObjectKey) {
    if (mediaKind === 'video' || (raster && /\.(mp4|webm|mov)(\?|#|$)/i.test(raster))) {
      return {
        displayKey,
        modality: 'video',
        ...(raster ? { imageSrc: raster } : {}),
        ...(resultCompanionKey ? { companionKey: resultCompanionKey } : {}),
      };
    }
    return {
      displayKey,
      modality: 'image',
      ...(raster ? { imageSrc: raster } : {}),
      ...(resultCompanionKey ? { companionKey: resultCompanionKey } : {}),
    };
  }

  const textBody = String((asset.textResults || {})[displayKey] ?? '').trim();
  if (textBody) {
    return { displayKey, modality: 'text', text: textBody };
  }

  return { displayKey, modality: 'empty' };
}

/** 文字卡拖入能力时拼接为 inputText（始终取正文/文槽，不跟显示图） */
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

/** 当前显示是否为文本通道（跟 displayKey 槽，不跟 assetKind） */
export function workflowAssetCurrentDisplayIsTextChannel(a: WorkflowAsset): boolean {
  return resolveWorkflowDisplaySlot(a).modality === 'text';
}

/** 大图预览是否应按位图处理（标注 / SAM / overlay 写回 / @当前画面 等） */
export function workflowAssetLightboxRasterEligible(a: WorkflowAsset, displayImage: string): boolean {
  const slot = resolveWorkflowDisplaySlot(a);
  if (slot.modality === 'text' || slot.modality === 'empty') return false;
  return Boolean(String(displayImage || '').trim() || slot.imageSrc || slot.companionKey);
}

/** 工作区卡片悬停 W 放大：当前有位图时可放大；纯文字通道也可放大阅读 */
export function workflowAssetCardZoomEligible(a: WorkflowAsset, displayImage: string): boolean {
  if (Boolean(String(displayImage || '').trim())) return true;
  return workflowAssetCurrentDisplayIsTextChannel(a);
}

/** 文字卡可拖入：文生文、文生图（指预设类别，不表示显示态） */
export function workflowPresetAcceptsTextCardDrag(mod: CustomAppModule): boolean {
  return mod.category === 'text_to_text' || mod.category === 'text_to_image';
}

function hasAnyTextPayload(asset: WorkflowAsset): boolean {
  if ((asset.textBody || '').trim()) return true;
  const textResults = asset.textResults || {};
  return Object.values(textResults).some((v) => String(v || '').trim() !== '');
}

function hasAnyImagePayload(asset: WorkflowAsset): boolean {
  // Birth shell does not veto: text cards may hold results rasters.
  if (!isWorkflowTextAsset(asset) && String(asset.original || '').trim()) return true;
  if (!isWorkflowTextAsset(asset) && String(asset.originalCompanionKey || '').trim()) return true;
  if (asset.displayKey && asset.displayKey !== 'original') {
    const curr = String((asset.results || {})[asset.displayKey] || '').trim();
    if (curr) return true;
    if (String((asset.resultsCompanionKeys || {})[asset.displayKey] || '').trim()) return true;
  }
  const results = asset.results || {};
  if (Object.values(results).some((v) => String(v || '').trim() !== '')) return true;
  const rck = asset.resultsCompanionKeys || {};
  if (Object.values(rck).some((v) => String(v || '').trim() !== '')) return true;
  if ((asset.cutImageGroup || []).some((it) => typeof it === 'string' && it.trim() !== '')) return true;
  return false;
}

function currentDisplayIsImageLike(asset: WorkflowAsset): boolean {
  const m = resolveWorkflowDisplaySlot(asset).modality;
  return m === 'image' || m === 'video';
}

/** 根资产拖入某预设：图类能力看当前显示槽；文生* 看是否有正文载荷 */
export function workflowAssetAllowedForCapabilityDrop(asset: WorkflowAsset, mod: CustomAppModule): boolean {
  if (presetUsesHostBundleProcessor(mod)) {
    return hasAnyImagePayload(asset) || hasAnyTextPayload(asset);
  }
  if (mod.category === 'text_to_text' || mod.category === 'text_to_image') {
    return hasAnyTextPayload(asset);
  }
  if (mod.category === 'generate_video') {
    return currentDisplayIsImageLike(asset) || workflowAssetCurrentDisplayIsTextChannel(asset);
  }
  if (
    mod.category === 'image_process' ||
    mod.category === 'image_to_image' ||
    mod.category === 'image_to_text' ||
    mod.category === 'generate_3d'
  ) {
    return currentDisplayIsImageLike(asset);
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

/** VGP 步骤树 / 版本节点：该 resultKey 是否按文本通道展示 */
export function workflowVersionDisplayIsTextChannel(asset: WorkflowAsset, resultKey: string): boolean {
  const key = String(resultKey || 'original').trim() || 'original';
  if (key === 'original') return isWorkflowTextAsset(asset);
  if (String((asset.results || {})[key] ?? '').trim()) return false;
  if (String((asset.resultsCompanionKeys || {})[key] || '').trim()) return false;
  return Boolean(String((asset.textResults || {})[key] ?? '').trim()) || isWorkflowTextAsset(asset);
}

export function resolveWorkflowVersionDisplayText(
  asset: WorkflowAsset,
  resultKey: string
): { title: string; body: string } {
  if (!workflowVersionDisplayIsTextChannel(asset, resultKey)) return { title: '', body: '' };
  const key = String(resultKey || 'original').trim() || 'original';
  if (key === 'original') {
    return { title: String(asset.textTitle || ''), body: String(asset.textBody || '') };
  }
  return { title: '', body: String((asset.textResults || {})[key] ?? '') };
}

/** 小节点缩略图：优先正文前几字，否则标题；空白则「文本」 */
export function workflowVersionTextSnippet(
  asset: WorkflowAsset,
  resultKey: string,
  maxLen = 28
): string {
  if (!workflowVersionDisplayIsTextChannel(asset, resultKey)) return '';
  const thumb = workflowVersionTextThumbLines(asset, resultKey);
  if (!thumb) return '';
  const visible = `${thumb.line1}${thumb.line2}`;
  if (thumb.showEllipsis) return `${visible}…`;
  return visible || thumb.fullText;
}

export type WorkflowVersionTextThumbLines = {
  line1: string;
  line2: string;
  showEllipsis: boolean;
  fullText: string;
};

/** 大图预览缩略节点：最多 6 字，两行各 3 字，超出第三行 … */
export function workflowVersionTextThumbLines(
  asset: WorkflowAsset,
  resultKey: string
): WorkflowVersionTextThumbLines | null {
  if (!workflowVersionDisplayIsTextChannel(asset, resultKey)) return null;
  const { title, body } = resolveWorkflowVersionDisplayText(asset, resultKey);
  const raw = (body || title).trim().replace(/\s+/g, '');
  const fullText = raw || '文本';
  const chars = [...fullText];
  return {
    line1: chars.slice(0, 3).join(''),
    line2: chars.slice(3, 6).join(''),
    showEllipsis: chars.length > 6,
    fullText,
  };
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
<text x="18" y="22" fill="#64748b" font-size="12" font-weight="600" font-family="ui-sans-serif,system-ui,sans-serif">文本资产</text>
<text x="18" y="${title1Y}" fill="#38bdf8" font-size="22" font-weight="700" font-family="ui-sans-serif,system-ui,sans-serif">${t1}</text>
${title2Svg}
${lineSvg}
</svg>`;
  return safeSvgDataUrl(svg);
}
