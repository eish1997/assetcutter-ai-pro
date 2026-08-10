export type RuntimeWorkspaceSurface =
  | 'workspace'
  | 'canvas'
  | 'lightbox'
  | 'workflow'
  | 'external'
  | 'none';

export type RuntimeWorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'blocked'
  | 'skipped';

export type RuntimeExternalSelectionKind =
  | 'none'
  | 'object'
  | 'layer'
  | 'mesh'
  | 'file'
  | 'timeline'
  | 'mixed'
  | 'unknown';

export type RuntimeEventSource =
  | 'user'
  | 'agent'
  | 'workflow'
  | 'external_app'
  | 'system';

export type RuntimeEventSeverity = 'debug' | 'info' | 'warn' | 'error';

export type RuntimeCapabilitySource =
  | 'workbench'
  | 'workflow'
  | 'external_app'
  | 'companion'
  | 'agent';

export type RuntimeCapabilityRisk = 'read' | 'light' | 'cost' | 'destructive';

export type RuntimeCapabilityTargetScope =
  | 'current'
  | 'selected'
  | 'group'
  | 'all'
  | 'external_selection';

export type RuntimeWorkspaceState = {
  projectId?: string;
  projectName?: string;
  activeSurface: RuntimeWorkspaceSurface;
  activeAssetId?: string;
  selectedAssetIds: string[];
  selectedAssetSummary?: string;
  activeStepId?: string;
  draftDirty?: boolean;
};

export type RuntimeBlocker = {
  id: string;
  summary: string;
  source?: RuntimeEventSource;
  severity?: Extract<RuntimeEventSeverity, 'warn' | 'error'>;
  entityRefs?: RuntimeEntityRef[];
};

export type RuntimePendingConfirmation = {
  id: string;
  summary: string;
  risk: RuntimeCapabilityRisk;
  targetScope?: RuntimeCapabilityTargetScope;
};

export type RuntimeWorkflowStep = {
  id: string;
  title: string;
  status: RuntimeWorkflowStepStatus;
  artifactIds?: string[];
  taskIds?: string[];
  lastError?: string;
};

export type RuntimeWorkflowState = {
  activePlanId?: string;
  activeRunId?: string;
  currentStepId?: string;
  hasPlan: boolean;
  steps: RuntimeWorkflowStep[];
  blockers: RuntimeBlocker[];
  pendingConfirmations: RuntimePendingConfirmation[];
};

export type RuntimeExternalCommandEvent = {
  id: string;
  ts: number;
  commandId: string;
  label?: string;
  status: 'requested' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  summary?: string;
};

export type RuntimeExternalSelection = {
  kind: RuntimeExternalSelectionKind;
  count?: number;
  summary?: string;
  ids?: string[];
  stale?: boolean;
};

export type RuntimeExternalAppState = {
  appId: string;
  name: string;
  connected: boolean;
  foreground?: boolean;
  activeDocument?: string;
  activeDocumentPath?: string;
  selection: RuntimeExternalSelection;
  currentTool?: string;
  unsavedChanges?: boolean;
  recentCommands: RuntimeExternalCommandEvent[];
  health: 'unknown' | 'ok' | 'degraded' | 'disconnected' | 'error';
  lastHeartbeatAt?: number;
};

export type RuntimeEntityRef = {
  kind:
    | 'asset'
    | 'task'
    | 'workflow'
    | 'workflow_step'
    | 'external_app'
    | 'external_document'
    | 'capability'
    | 'agent_turn';
  id: string;
  label?: string;
};

export type RuntimeEvent = {
  id: string;
  ts: number;
  source: RuntimeEventSource;
  type: string;
  summary: string;
  entityRefs?: RuntimeEntityRef[];
  severity?: RuntimeEventSeverity;
  correlationId?: string;
};

export type RuntimeCapability = {
  id: string;
  label: string;
  source: RuntimeCapabilitySource;
  appId?: string;
  enabled: boolean;
  unavailableReason?: string;
  risk: RuntimeCapabilityRisk;
  targetScope?: RuntimeCapabilityTargetScope;
  requiresConfirmation: boolean;
};

export type RuntimePerceptionRisk = {
  id: string;
  summary: string;
  level: 'info' | 'warn' | 'block';
  source?: RuntimeEventSource;
};

export type RuntimePerceptionSnapshot = {
  version: 1;
  capturedAt: number;
  freshnessMs: number;
  workspace: RuntimeWorkspaceState;
  workflow: RuntimeWorkflowState;
  externalApps: RuntimeExternalAppState[];
  capabilities: RuntimeCapability[];
  recentEvents: RuntimeEvent[];
  risks: RuntimePerceptionRisk[];
};

export type RuntimePerceptionPatch = Partial<
  Omit<RuntimePerceptionSnapshot, 'version' | 'capturedAt' | 'freshnessMs' | 'recentEvents'>
>;

export type ProjectAgentPerceptionContext = {
  visibleSummary: string;
  targetSummary: string;
  workflowSummary?: string;
  externalSummary?: string;
  recentEventSummary?: string;
  capabilitySummary?: string;
  riskSummary?: string;
  stale: boolean;
};
