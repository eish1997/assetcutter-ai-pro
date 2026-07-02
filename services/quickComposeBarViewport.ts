/** 工作区底部快捷输入条：视口边界与展开高度预算 */

export const QUICK_COMPOSE_VIEW_MARGIN = 8;

/** 展开态：输入区下方工具行 + 内边距（约） */
export const QUICK_COMPOSE_EXPANDED_CHROME_BELOW_TEXT_PX = 92;

/** 与 QuickComposeMentionField MULTILINE_LINE_PX 对齐 */
export const QUICK_COMPOSE_MULTILINE_LINE_PX = 28;

/** 浮在药丸上方的预设 / 拖放区（absolute bottom-full） */
export function measureQuickComposeBarOverhangTop(barEl: HTMLElement): number {
  const barTop = barEl.getBoundingClientRect().top;
  let minTop = barTop;
  barEl.querySelectorAll<HTMLElement>('[data-quick-compose-above]').forEach((node) => {
    const r = node.getBoundingClientRect();
    if (r.height > 0.5) minTop = Math.min(minTop, r.top);
  });
  return Math.max(0, barTop - minTop);
}

export function clampQuickComposeBarPosition(
  pos: { left: number; top: number },
  barEl: HTMLElement | null,
  vw: number,
  vh: number,
  viewMargin = QUICK_COMPOSE_VIEW_MARGIN
): { left: number; top: number } {
  let w: number;
  let h: number;
  let overhangTop = 0;
  if (barEl) {
    const r = barEl.getBoundingClientRect();
    w = r.width;
    h = r.height;
    overhangTop = measureQuickComposeBarOverhangTop(barEl);
  } else {
    w = Math.min(704, Math.max(280, vw - 24));
    h = 64;
  }
  const maxLeft = Math.max(viewMargin, vw - w - viewMargin);
  const minTop = viewMargin + overhangTop;
  const maxTop = Math.max(minTop, vh - h - viewMargin);
  return {
    left: Math.max(viewMargin, Math.min(maxLeft, pos.left)),
    top: Math.max(minTop, Math.min(maxTop, pos.top)),
  };
}

/** 展开多行时 textarea 可用最大高度（保证整条 + 上方浮层不超出视口） */
export function computeQuickComposeExpandedTextMaxHeight(
  barEl: HTMLElement,
  opts: {
    viewMargin?: number;
    chromeBelowTextPx?: number;
    anchorBottom?: number | null;
  } = {}
): number {
  const viewMargin = opts.viewMargin ?? QUICK_COMPOSE_VIEW_MARGIN;
  const chromeBelow = opts.chromeBelowTextPx ?? QUICK_COMPOSE_EXPANDED_CHROME_BELOW_TEXT_PX;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const rect = barEl.getBoundingClientRect();
  const overhang = measureQuickComposeBarOverhangTop(barEl);
  const minTop = viewMargin + overhang;
  const maxBottom = vh - viewMargin;
  const anchorBottom =
    opts.anchorBottom != null && Number.isFinite(opts.anchorBottom)
      ? Math.min(opts.anchorBottom, maxBottom)
      : Math.min(rect.bottom, maxBottom);
  const available = anchorBottom - minTop - chromeBelow;
  return Math.max(QUICK_COMPOSE_MULTILINE_LINE_PX * 3, Math.floor(available));
}
