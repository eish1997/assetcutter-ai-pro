/**
 * 工作流侧 **sessionStorage**、**localStorage 镜像**与 **Overlay 环 IndexedDB** 共用的 `preferenceScope`（与 `scopedStorageKey` 一致）。
 * 由 `WorkflowSection` 在挂载时设置；**`workflowAuditEvents`**、**`workflowOverlaySnapshots`** 等只读此值拼 **session / local / IndexedDB** 镜像键。
 */
let workflowMirrorPreferenceScope: string | null = null;

export function setWorkflowMirrorPreferenceScope(scope: string | null | undefined): void {
  workflowMirrorPreferenceScope = scope ?? null;
}

export function getWorkflowMirrorPreferenceScope(): string | null {
  return workflowMirrorPreferenceScope;
}
