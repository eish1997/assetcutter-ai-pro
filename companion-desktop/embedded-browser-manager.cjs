'use strict';

/**
 * BrowserView 布局与 detach 辅助。
 * 工作台 / 连接 / 工具 允许同时挂载 dsh BrowserView。
 */

/** 工作台与 dsh 之间留缝，给壳 HTML 拖条吃鼠标，避免被 BrowserView 盖住。 */
const DSH_SPLITTER_WIDTH_PX = 6;

function computeEmbeddedBrowserBounds(contentBounds, insets) {
  const dual = computeWorkbenchAndDshBounds(contentBounds, {
    ...insets,
    dshPaneWidthPx: Number(insets?.dshPaneWidthPx) || Number(insets?.copilotEffectiveWidthPx) || 0,
  });
  return dual.workbench;
}

function computeWorkbenchAndDshBounds(contentBounds, insets) {
  const b = contentBounds && typeof contentBounds === 'object' ? contentBounds : { width: 800, height: 600 };
  const sidebar = Number(insets?.sidebarInsetPx) || 0;
  const titlebar = Number(insets?.titlebarHeightPx) || 30;
  const toolbar = Number(insets?.toolbarHeightPx) || 0;
  const dshPane = Math.max(0, Number(insets?.dshPaneWidthPx) || 0);
  const splitter = dshPane > 0 ? DSH_SPLITTER_WIDTH_PX : 0;
  const y = titlebar + toolbar;
  const h = Math.max(120, (Number(b.height) || 600) - y);
  const totalW = Number(b.width) || 800;
  const workbenchW = Math.max(120, totalW - sidebar - dshPane - splitter);
  const workbench = { x: sidebar, y, width: workbenchW, height: h };
  const dsh = {
    x: sidebar + workbenchW + splitter,
    y,
    width: dshPane,
    height: h,
  };
  return { workbench, dsh };
}

function detachBrowserViews(mainWindow, views) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const list = Array.isArray(views) ? views : [];
  for (const v of list) {
    if (!v) continue;
    try {
      mainWindow.removeBrowserView(v);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  DSH_SPLITTER_WIDTH_PX,
  computeEmbeddedBrowserBounds,
  computeWorkbenchAndDshBounds,
  detachBrowserViews,
};
