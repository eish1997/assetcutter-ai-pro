'use strict';

/**
 * 壳窗口拿到键盘、工作台 BrowserView 没焦点时，空格框选进不了页面。
 * 光标在工作台矩形内则把 Space 转给工作台。
 */

function isSpaceInput(input) {
  if (!input || typeof input !== 'object') return false;
  const code = String(input.code || '');
  const key = String(input.key || '');
  return code === 'Space' || key === ' ' || key === 'Space';
}

function pointInRect(x, y, rect) {
  if (!rect) return false;
  const left = Number(rect.x) || 0;
  const top = Number(rect.y) || 0;
  const w = Number(rect.width) || 0;
  const h = Number(rect.height) || 0;
  return x >= left && y >= top && x < left + w && y < top + h;
}

/** contentBounds 与 cursor 均为屏幕坐标；viewBounds 相对窗口内容区 */
function isCursorInViewBounds(screenPoint, contentBounds, viewBounds) {
  if (!screenPoint || !contentBounds || !viewBounds) return false;
  const x = Number(screenPoint.x) - Number(contentBounds.x);
  const y = Number(screenPoint.y) - Number(contentBounds.y);
  return pointInRect(x, y, viewBounds);
}

function shouldForwardSpaceToWorkbench(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  if (!isSpaceInput(o.input)) return false;
  const type = String(o.input && o.input.type);
  if (type !== 'keyDown' && type !== 'keyUp') return false;
  if (o.input && o.input.isAutoRepeat && type === 'keyDown') return false;
  if (String(o.shellView || '') !== 'workbench') return false;
  if (!o.cursorInWorkbench) return false;
  return true;
}

function spaceMarqueeIpcPayload(input) {
  return { down: String(input && input.type) === 'keyDown' };
}

module.exports = {
  isSpaceInput,
  isCursorInViewBounds,
  shouldForwardSpaceToWorkbench,
  spaceMarqueeIpcPayload,
};
