'use strict';

const DSH_PANE_WIDTH_DEFAULT = 480;
const DSH_PANE_WIDTH_MIN = 420;
const DSH_PANE_WIDTH_MAX = 900;

function clampDshPaneWidth(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return DSH_PANE_WIDTH_DEFAULT;
  return Math.min(DSH_PANE_WIDTH_MAX, Math.max(DSH_PANE_WIDTH_MIN, Math.round(x)));
}

function readDshPaneWidthFromSettings(settings) {
  if (!settings || settings.dshPaneWidth == null || settings.dshPaneWidth === '') {
    return DSH_PANE_WIDTH_DEFAULT;
  }
  return clampDshPaneWidth(settings.dshPaneWidth);
}

function withDshPaneWidth(settings, width) {
  return { ...(settings && typeof settings === 'object' ? settings : {}), dshPaneWidth: clampDshPaneWidth(width) };
}

function readDshPaneCollapsedFromSettings(settings) {
  return Boolean(settings && settings.dshPaneCollapsed);
}

function withDshPaneCollapsed(settings, collapsed) {
  return {
    ...(settings && typeof settings === 'object' ? settings : {}),
    dshPaneCollapsed: Boolean(collapsed),
  };
}

function resolveDshPaneChrome(payload, current) {
  const cur = current && typeof current === 'object' ? current : {};
  const width =
    payload && payload.dshPaneWidth != null && payload.dshPaneWidth !== ''
      ? clampDshPaneWidth(payload.dshPaneWidth)
      : clampDshPaneWidth(cur.dshPaneWidthPx);
  const collapsed =
    payload && payload.dshPaneCollapsed != null
      ? Boolean(payload.dshPaneCollapsed)
      : Boolean(cur.dshPaneCollapsed);
  return {
    dshPaneWidthPx: width,
    dshPaneCollapsed: collapsed,
    visiblePx: collapsed ? 0 : width,
  };
}

module.exports = {
  DSH_PANE_WIDTH_DEFAULT,
  DSH_PANE_WIDTH_MIN,
  DSH_PANE_WIDTH_MAX,
  clampDshPaneWidth,
  readDshPaneWidthFromSettings,
  withDshPaneWidth,
  readDshPaneCollapsedFromSettings,
  withDshPaneCollapsed,
  resolveDshPaneChrome,
};
