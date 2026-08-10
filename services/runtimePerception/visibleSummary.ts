import type {
  ProjectAgentPerceptionContext,
  RuntimeCapability,
  RuntimeExternalAppState,
  RuntimePerceptionSnapshot,
  RuntimeWorkflowState,
  RuntimeWorkspaceState,
} from '../../types/runtimePerception';
import { sanitizeRuntimePerceptionText, uniqueCleanStrings } from './sanitize';

export const RUNTIME_PERCEPTION_STALE_MS = 30_000;

function joinParts(parts: Array<string | undefined | false>, fallback = ''): string {
  const text = parts
    .map((part) => sanitizeRuntimePerceptionText(part, 120))
    .filter(Boolean)
    .join(' | ');
  return text || fallback;
}

export function summarizeRuntimeWorkspace(state: RuntimeWorkspaceState): string {
  const selectedCount = state.selectedAssetIds.length;
  const target =
    state.selectedAssetSummary ||
    (selectedCount > 0
      ? `Selected ${selectedCount} asset${selectedCount === 1 ? '' : 's'}`
      : state.activeAssetId
        ? 'Current asset'
        : 'No selected asset');
  return joinParts([
    state.projectName ? `Project: ${state.projectName}` : state.projectId ? `Project: ${state.projectId}` : 'No project',
    `Surface: ${state.activeSurface}`,
    target,
    state.draftDirty ? 'Unsaved local changes' : undefined,
  ]);
}

export function summarizeRuntimeWorkflow(state: RuntimeWorkflowState): string | undefined {
  if (!state.hasPlan && state.steps.length === 0 && state.blockers.length === 0) return undefined;
  const total = state.steps.length;
  const done = state.steps.filter((step) => step.status === 'done').length;
  const running = state.steps.find((step) => step.status === 'running');
  const failed = state.steps.find((step) => step.status === 'failed' || step.status === 'blocked');
  return joinParts([
    state.activePlanId ? `Plan: ${state.activePlanId}` : 'Workflow plan active',
    total > 0 ? `${done}/${total} steps done` : undefined,
    running ? `Running: ${running.title}` : undefined,
    failed ? `Blocked: ${failed.lastError || failed.title}` : undefined,
    state.blockers.length ? `${state.blockers.length} blocker${state.blockers.length === 1 ? '' : 's'}` : undefined,
  ]);
}

function summarizeExternalSelection(app: RuntimeExternalAppState): string {
  const selection = app.selection;
  if (selection.summary) return selection.summary;
  if (selection.kind === 'unknown') return 'selection unknown';
  if (selection.kind === 'none') return 'nothing selected';
  if (typeof selection.count === 'number') {
    return `${selection.count} ${selection.kind}${selection.count === 1 ? '' : 's'} selected`;
  }
  return `${selection.kind} selection`;
}

export function summarizeRuntimeExternalApps(apps: readonly RuntimeExternalAppState[]): string | undefined {
  if (!apps.length) return undefined;
  const connected = apps.filter((app) => app.connected);
  const primary = connected[0] ?? apps[0];
  if (!primary) return undefined;
  return joinParts([
    `${primary.name}: ${primary.connected ? 'connected' : 'disconnected'}`,
    primary.activeDocument ? `Doc: ${primary.activeDocument}` : undefined,
    summarizeExternalSelection(primary),
    primary.health !== 'unknown' ? `Health: ${primary.health}` : undefined,
  ]);
}

function summarizeCapabilities(capabilities: readonly RuntimeCapability[]): string | undefined {
  const enabled = capabilities.filter((capability) => capability.enabled);
  if (!enabled.length) return undefined;
  const labels = uniqueCleanStrings(enabled.map((capability) => capability.label), 5);
  return labels.length ? `Available: ${labels.join(', ')}` : undefined;
}

export function buildProjectAgentPerceptionContext(
  snapshot: RuntimePerceptionSnapshot,
  staleMs = RUNTIME_PERCEPTION_STALE_MS
): ProjectAgentPerceptionContext {
  const stale = snapshot.freshnessMs > staleMs;
  const targetSummary = summarizeRuntimeWorkspace(snapshot.workspace);
  const workflowSummary = summarizeRuntimeWorkflow(snapshot.workflow);
  const externalSummary = summarizeRuntimeExternalApps(snapshot.externalApps);
  const recentEventSummary = snapshot.recentEvents.length
    ? uniqueCleanStrings(snapshot.recentEvents.map((event) => event.summary), 5).join(' / ')
    : undefined;
  const capabilitySummary = summarizeCapabilities(snapshot.capabilities);
  const riskSummary = snapshot.risks.length
    ? uniqueCleanStrings(snapshot.risks.map((risk) => risk.summary), 4).join(' / ')
    : undefined;
  const visibleSummary = joinParts([
    targetSummary,
    workflowSummary,
    externalSummary,
    stale ? 'Context may be stale' : undefined,
  ]);
  return {
    visibleSummary,
    targetSummary,
    ...(workflowSummary ? { workflowSummary } : {}),
    ...(externalSummary ? { externalSummary } : {}),
    ...(recentEventSummary ? { recentEventSummary } : {}),
    ...(capabilitySummary ? { capabilitySummary } : {}),
    ...(riskSummary ? { riskSummary } : {}),
    stale,
  };
}

export function formatPerceptionForPlanPrefix(
  perception: ProjectAgentPerceptionContext | undefined
): string {
  if (!perception) return '';
  return sanitizeRuntimePerceptionText(perception.visibleSummary, 220);
}
