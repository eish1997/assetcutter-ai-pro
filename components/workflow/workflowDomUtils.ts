/** 灯箱主舞台或非图预览画布在场时，工作区 1/2 切页应让出 */
export function isWorkflowLightboxHotkeySurface(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('[data-lightbox-main-stage], [data-asset-preview-canvas]'));
}

/** 事件目标是否为可编辑区（输入框、contenteditable 等），用于快捷键与全局手势让出焦点 */
export function isWorkflowEditableTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  if (el.closest('input, textarea, select, [contenteditable="true"]')) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}
