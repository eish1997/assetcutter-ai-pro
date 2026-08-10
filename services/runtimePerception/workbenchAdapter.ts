import type {
  RuntimeCapability,
  RuntimePerceptionRisk,
  RuntimeWorkspaceState,
  RuntimeWorkspaceSurface,
} from '../../types/runtimePerception';
import { sanitizeRuntimePerceptionText, uniqueCleanStrings } from './sanitize';

export type BuildRuntimeWorkspaceStateInput = {
  projectId?: string | null;
  projectName?: string | null;
  activeSurface?: RuntimeWorkspaceSurface | null;
  activeAssetId?: string | null;
  selectedAssetIds?: Iterable<string> | readonly string[] | null;
  activeStepId?: string | null;
  draftDirty?: boolean;
};

export function buildRuntimeWorkspaceState(
  input: BuildRuntimeWorkspaceStateInput
): RuntimeWorkspaceState {
  const selectedAssetIds = uniqueCleanStrings(Array.from(input.selectedAssetIds ?? []), 100);
  const selectedAssetSummary =
    selectedAssetIds.length > 0
      ? `Selected ${selectedAssetIds.length} asset${selectedAssetIds.length === 1 ? '' : 's'}`
      : undefined;
  return {
    ...(input.projectId ? { projectId: sanitizeRuntimePerceptionText(input.projectId, 120) } : {}),
    ...(input.projectName ? { projectName: sanitizeRuntimePerceptionText(input.projectName, 120) } : {}),
    activeSurface: input.activeSurface ?? 'none',
    ...(input.activeAssetId ? { activeAssetId: sanitizeRuntimePerceptionText(input.activeAssetId, 120) } : {}),
    selectedAssetIds,
    ...(selectedAssetSummary ? { selectedAssetSummary } : {}),
    ...(input.activeStepId ? { activeStepId: sanitizeRuntimePerceptionText(input.activeStepId, 120) } : {}),
    ...(typeof input.draftDirty === 'boolean' ? { draftDirty: input.draftDirty } : {}),
  };
}

export function buildWorkbenchSelectionCapabilities(
  workspace: RuntimeWorkspaceState
): RuntimeCapability[] {
  const count = workspace.selectedAssetIds.length;
  return [
    {
      id: 'workbench.inspect_selection',
      label: count > 0 ? `Inspect selected assets (${count})` : 'Inspect current workspace',
      source: 'workbench',
      enabled: true,
      risk: 'read',
      targetScope: count > 0 ? 'selected' : 'current',
      requiresConfirmation: false,
    },
    {
      id: 'workbench.apply_to_selection',
      label: count > 0 ? `Apply to selected assets (${count})` : 'Apply to selected assets',
      source: 'workbench',
      enabled: count > 0,
      unavailableReason: count > 0 ? undefined : 'No selected assets',
      risk: 'cost',
      targetScope: 'selected',
      requiresConfirmation: true,
    },
  ];
}

export function buildWorkbenchPerceptionRisks(
  workspace: RuntimeWorkspaceState
): RuntimePerceptionRisk[] {
  const risks: RuntimePerceptionRisk[] = [];
  if (workspace.draftDirty) {
    risks.push({
      id: 'workbench.draft_dirty',
      summary: 'Current workspace has unsaved local edits',
      level: 'warn',
      source: 'user',
    });
  }
  return risks;
}
