import {
  resolveWorkflowCardDropIntent,
  type WorkflowCardDropIntent,
} from './workflowGridDragHints';
import { clearAllWorkflowDropTargets } from './workflowDropHighlight';

export type WorkflowCardDragDropSession = {
  targetKey: string;
  intent: WorkflowCardDropIntent;
};

let activeSession: WorkflowCardDragDropSession | null = null;

export function readWorkflowCardDragDropSession(): WorkflowCardDragDropSession | null {
  return activeSession;
}

export function markWorkflowCardDropIntent(el: HTMLElement, intent: WorkflowCardDropIntent): void {
  const visualIntent = intent === 'insert-before' || intent === 'insert-after' ? 'insert' : intent;
  const insertEdge =
    intent === 'insert-before' ? 'before' : intent === 'insert-after' ? 'after' : null;
  if (
    el.getAttribute('data-drop-intent') === visualIntent &&
    (insertEdge ? el.getAttribute('data-drop-insert-edge') === insertEdge : !el.hasAttribute('data-drop-insert-edge'))
  ) {
    return;
  }
  el.setAttribute('data-drop-intent', visualIntent);
  if (insertEdge) el.setAttribute('data-drop-insert-edge', insertEdge);
  else el.removeAttribute('data-drop-insert-edge');
}

export function clearWorkflowCardDropIntent(el: HTMLElement): void {
  el.removeAttribute('data-drop-intent');
  el.removeAttribute('data-drop-insert-edge');
}

export function clearWorkflowCardDragDropSession(root?: ParentNode | null): void {
  activeSession = null;
  if (typeof document !== 'undefined') {
    document.querySelectorAll<HTMLElement>('[data-workflow-drop-host]').forEach((node) => {
      clearWorkflowCardDropIntent(node);
    });
  }
  clearAllWorkflowDropTargets(root);
}

export function updateWorkflowCardDragOver(
  hostEl: HTMLElement,
  targetKey: string,
  clientX: number,
  clientY: number,
  opts: { allowGroup?: boolean } = {}
): WorkflowCardDropIntent {
  const intent = resolveWorkflowCardDropIntent(
    clientX,
    clientY,
    hostEl.getBoundingClientRect(),
    opts
  );
  markWorkflowCardDropIntent(hostEl, intent);
  activeSession = { targetKey, intent };
  return intent;
}

export function workflowCardDragLeave(hostEl: HTMLElement, targetKey: string): void {
  clearWorkflowCardDropIntent(hostEl);
  if (activeSession?.targetKey === targetKey) {
    activeSession = null;
  }
}
