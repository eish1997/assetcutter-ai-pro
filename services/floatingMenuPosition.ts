export const FLOATING_MENU_MARGIN = 8;
export const FLOATING_MENU_GAP = 4;

export type AnchorRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** 右键菜单：默认向右下展开，贴边时向左 / 向上翻转 */
export function computeContextMenuPosition(
  anchorX: number,
  anchorY: number,
  menuWidth: number,
  menuHeight: number,
  vw: number,
  vh: number,
  margin = FLOATING_MENU_MARGIN
): { left: number; top: number } {
  let left = anchorX;
  let top = anchorY;

  if (left + menuWidth > vw - margin) {
    left = anchorX - menuWidth;
  }
  if (top + menuHeight > vh - margin) {
    top = anchorY - menuHeight;
  }

  left = Math.max(margin, Math.min(left, vw - menuWidth - margin));
  top = Math.max(margin, Math.min(top, vh - menuHeight - margin));

  return { left, top };
}

/** 锚定浮层（@ 选择器等）：默认向右下展开，贴边时向左 / 向上翻转 */
export function layoutAnchoredFloatingMenu(input: {
  anchor: AnchorRect;
  menuWidth: number;
  naturalMenuHeight: number;
  preferredMaxHeight: number;
  gap?: number;
  margin?: number;
  vw?: number;
  vh?: number;
}): { left: number; top: number; maxHeight: number } {
  const gap = input.gap ?? FLOATING_MENU_GAP;
  const margin = input.margin ?? FLOATING_MENU_MARGIN;
  const vw = input.vw ?? (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = input.vh ?? (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const width = input.menuWidth;

  let left = input.anchor.left;
  if (left + width > vw - margin) {
    left = input.anchor.right - width;
  }
  left = Math.max(margin, Math.min(left, vw - width - margin));

  const spaceBelow = vh - input.anchor.bottom - gap - margin;
  const spaceAbove = input.anchor.top - gap - margin;
  const openDown =
    spaceBelow >= input.naturalMenuHeight || spaceBelow >= spaceAbove;
  const maxHeight = Math.min(
    input.preferredMaxHeight,
    Math.max(80, openDown ? spaceBelow : spaceAbove)
  );
  const menuHeight = Math.min(input.naturalMenuHeight, maxHeight);

  let top = openDown ? input.anchor.bottom + gap : input.anchor.top - gap - menuHeight;
  top = Math.max(margin, Math.min(top, vh - menuHeight - margin));

  return { left, top, maxHeight };
}

/** 相对锚定容器：上方空间不足时改为向下展开 */
export function shouldOpenAnchoredMenuUp(input: {
  anchorTop: number;
  anchorBottom: number;
  menuHeight: number;
  margin?: number;
  vh?: number;
}): boolean {
  const margin = input.margin ?? FLOATING_MENU_MARGIN;
  const vh = input.vh ?? (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const spaceAbove = input.anchorTop - margin;
  const spaceBelow = vh - input.anchorBottom - margin;
  return spaceAbove >= input.menuHeight || spaceAbove >= spaceBelow;
}
