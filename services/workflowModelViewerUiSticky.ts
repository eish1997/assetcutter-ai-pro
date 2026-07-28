import type { WorkflowModelPbrEditDoc } from './workflowModelPbrEdits';

/**
 * Survive React StrictMode remount (and brief parent remounts) so a cache-fast
 * reopen does not flash "loading" + empty PBR panel after already showing ready.
 *
 * Slot materials may be briefly stale until the remounted effect finishes load;
 * that window is typically one frame when the scene cache hits.
 */
export type WorkflowModelViewerUiSticky = {
  loadKey: string;
  status: 'loading' | 'ready' | 'error' | 'unsupported';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viewer-local MaterialSlotInfo
  materialSlots: any[];
  activeMaterialId: string;
  pbrDoc: WorkflowModelPbrEditDoc | null;
  updatedAt: number;
};

let sticky: WorkflowModelViewerUiSticky | null = null;

const STICKY_TTL_MS = 120_000;

export function rememberWorkflowModelViewerUiSticky(
  next: Omit<WorkflowModelViewerUiSticky, 'updatedAt'>
): void {
  sticky = { ...next, updatedAt: Date.now() };
}

export function peekWorkflowModelViewerUiSticky(
  loadKey: string
): WorkflowModelViewerUiSticky | null {
  const key = String(loadKey || '').trim();
  if (!key || !sticky || sticky.loadKey !== key) return null;
  if (Date.now() - sticky.updatedAt > STICKY_TTL_MS) {
    sticky = null;
    return null;
  }
  return sticky;
}

export function clearWorkflowModelViewerUiSticky(loadKey?: string): void {
  const key = String(loadKey || '').trim();
  if (!key || sticky?.loadKey === key) sticky = null;
}
