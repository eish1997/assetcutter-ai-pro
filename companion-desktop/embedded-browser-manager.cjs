'use strict';

/**
 * 单槽 BrowserView 布局与 detach 辅助（P0）。
 * 工作台 BrowserView 与壳内页面布局辅助，同一时刻仅挂载一个 BrowserView。
 */

function computeEmbeddedBrowserBounds(contentBounds, insets) {
  const b = contentBounds && typeof contentBounds === 'object' ? contentBounds : { width: 800, height: 600 };
  const sidebar = Number(insets?.sidebarInsetPx) || 0;
  const titlebar = Number(insets?.titlebarHeightPx) || 30;
  const toolbar = Number(insets?.toolbarHeightPx) || 0;
  const copilot = Number(insets?.copilotEffectiveWidthPx) || 0;
  const x = sidebar;
  const y = titlebar + toolbar;
  const w = Math.max(120, b.width - sidebar - copilot);
  const h = Math.max(120, b.height - y);
  return { x, y, width: w, height: h };
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

module.exports = { computeEmbeddedBrowserBounds, detachBrowserViews };
