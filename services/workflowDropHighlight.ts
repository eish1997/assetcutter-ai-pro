/** 拖放高亮：用 DOM `data-drag-over` 替代 React state，避免 dragover 触发整页重绘。 */

export function markWorkflowDropTarget(el: HTMLElement): void {
  if (el.getAttribute('data-drag-over') === '1') return;
  el.setAttribute('data-drag-over', '1');
}

export function clearWorkflowDropTarget(el: HTMLElement): void {
  el.removeAttribute('data-drag-over');
}

export function workflowDropDragLeave(el: HTMLElement, e: { relatedTarget: EventTarget | null }): void {
  const rel = e.relatedTarget as Node | null;
  if (rel && el.contains(rel)) return;
  clearWorkflowDropTarget(el);
}

export function clearAllWorkflowDropTargets(root?: ParentNode | null): void {
  const scope = root ?? (typeof document !== 'undefined' ? document : null);
  if (!scope) return;
  scope.querySelectorAll('[data-drag-over]').forEach((node) => {
    node.removeAttribute('data-drag-over');
  });
}
