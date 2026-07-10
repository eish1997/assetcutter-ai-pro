/**
 * Project Agent thread export — Phase 5 / U4 5C.
 * Slim JSON only: ids / text / status / timestamps / planSteps / childRuns meta.
 * No media bytes / data-URL base64.
 */

import type { QuickComposeThreadMessage } from '../../types/quickComposeThread';
import type { ProjectAgentThread } from './threadStore';

/** Strip data URLs and long standalone base64 blobs from arbitrary JSON-ish values. */
export function stripBase64FromExportValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^data:[^;]+;base64,/i.test(value)) return '[omitted-data-url]';
    if (value.length > 256 && /^(?:[A-Za-z0-9+/]{64,}={0,2})$/.test(value.replace(/\s/g, ''))) {
      return '[omitted-base64]';
    }
    if (/data:[^;]+;base64,/i.test(value)) {
      return value.replace(/data:[^;]+;base64,[A-Za-z0-9+/=\s]+/gi, '[omitted-data-url]');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(stripBase64FromExportValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripBase64FromExportValue(v);
    }
    return out;
  }
  return value;
}

function slimChildRun(raw: NonNullable<QuickComposeThreadMessage['childRuns']>[number]) {
  return {
    id: raw.id,
    kind: raw.kind,
    label: raw.label,
    ...(raw.expertId ? { expertId: raw.expertId } : {}),
    ...(raw.toolId ? { toolId: raw.toolId } : {}),
    status: raw.status,
    ...(raw.taskIds?.length ? { taskIds: raw.taskIds } : {}),
    ...(raw.artifactIds?.length ? { artifactIds: raw.artifactIds } : {}),
    ...(raw.errorMessage ? { errorMessage: raw.errorMessage } : {}),
    startedAt: raw.startedAt,
    ...(typeof raw.endedAt === 'number' ? { endedAt: raw.endedAt } : {}),
  };
}

/** Keep only export-safe message fields (no attachment thumbs / media). */
export function slimMessageForExport(message: QuickComposeThreadMessage): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: message.id,
    role: message.role,
    text: typeof message.text === 'string' ? message.text : '',
    timestamp: message.timestamp,
  };
  if (message.status) out.status = message.status;
  if (message.assetIds?.length) out.assetIds = message.assetIds;
  if (message.taskIds?.length) out.taskIds = message.taskIds;
  if (message.taskAssetById && Object.keys(message.taskAssetById).length) {
    out.taskAssetById = message.taskAssetById;
  }
  if (typeof message.resultText === 'string' && message.resultText.trim()) {
    out.resultText = message.resultText;
  }
  if (typeof message.errorMessage === 'string' && message.errorMessage.trim()) {
    out.errorMessage = message.errorMessage;
  }
  if (message.planSteps?.length) {
    out.planSteps = message.planSteps.map((s) => ({
      label: s.label,
      ...(s.toolId ? { toolId: s.toolId } : {}),
    }));
  }
  if (message.childRuns?.length) {
    out.childRuns = message.childRuns.map(slimChildRun);
  }
  return out;
}

/**
 * Serialize a project-agent thread to slim JSON string.
 * Always runs base64 / data-URL stripping on the final payload.
 */
export function exportProjectAgentThreadSlimJson(thread: ProjectAgentThread): string {
  const payload = {
    version: 1 as const,
    exportedAt: Date.now(),
    id: thread.id,
    workspaceProjectId: thread.workspaceProjectId,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messages: (Array.isArray(thread.messages) ? thread.messages : []).map(slimMessageForExport),
  };
  return JSON.stringify(stripBase64FromExportValue(payload), null, 2);
}

/** Filename: project-agent-{projectId截断}-{ts}.json */
export function buildProjectAgentExportFilename(projectId: string): string {
  const raw = String(projectId || 'project').trim() || 'project';
  const safe = raw.replace(/[^\w.-]+/g, '_').slice(0, 24) || 'project';
  return `project-agent-${safe}-${Date.now()}.json`;
}

/**
 * Browser download of slim export JSON.
 * Safe to call from UI callbacks; no-ops when `document` is unavailable.
 */
export function downloadProjectAgentThreadSlimJson(
  thread: ProjectAgentThread,
  projectId?: string
): void {
  if (typeof document === 'undefined') return;
  const json = exportProjectAgentThreadSlimJson(thread);
  const filename = buildProjectAgentExportFilename(projectId || thread.workspaceProjectId);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }, 30_000);
}
