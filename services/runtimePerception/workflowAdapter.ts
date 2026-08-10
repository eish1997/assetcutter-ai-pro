import type {
  RuntimeBlocker,
  RuntimeCapability,
  RuntimeWorkflowState,
  RuntimeWorkflowStep,
  RuntimeWorkflowStepStatus,
} from '../../types/runtimePerception';
import { sanitizeRuntimePerceptionText, uniqueCleanStrings } from './sanitize';

export type RuntimeWorkflowStepLike = {
  id?: string;
  stepId?: string;
  title?: string;
  label?: string;
  status?: string;
  artifactIds?: readonly string[];
  taskIds?: readonly string[];
  error?: string;
  errorMessage?: string;
};

export type BuildRuntimeWorkflowStateInput = {
  activePlanId?: string | null;
  activeRunId?: string | null;
  currentStepId?: string | null;
  steps?: readonly RuntimeWorkflowStepLike[] | null;
  blockers?: readonly RuntimeBlocker[] | readonly string[] | null;
  pendingConfirmations?: RuntimeWorkflowState['pendingConfirmations'];
};

function normalizeStepStatus(status: unknown): RuntimeWorkflowStepStatus {
  const text = String(status ?? '').toLowerCase();
  if (text === 'running' || text === 'executing' || text === 'active') return 'running';
  if (text === 'done' || text === 'success' || text === 'completed') return 'done';
  if (text === 'failed' || text === 'error') return 'failed';
  if (text === 'blocked') return 'blocked';
  if (text === 'skipped' || text === 'cancelled') return 'skipped';
  return 'pending';
}

function normalizeStep(step: RuntimeWorkflowStepLike, index: number): RuntimeWorkflowStep {
  const id = sanitizeRuntimePerceptionText(step.id || step.stepId || `step-${index + 1}`, 120);
  const title = sanitizeRuntimePerceptionText(step.title || step.label || id, 160);
  const lastError = sanitizeRuntimePerceptionText(step.errorMessage || step.error || '', 200);
  return {
    id,
    title,
    status: normalizeStepStatus(step.status),
    ...(step.artifactIds?.length ? { artifactIds: uniqueCleanStrings(step.artifactIds, 50) } : {}),
    ...(step.taskIds?.length ? { taskIds: uniqueCleanStrings(step.taskIds, 50) } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

function normalizeBlockers(blockers: BuildRuntimeWorkflowStateInput['blockers']): RuntimeBlocker[] {
  return (blockers ?? []).map((blocker, index) => {
    if (typeof blocker === 'string') {
      return {
        id: `blocker-${index + 1}`,
        summary: sanitizeRuntimePerceptionText(blocker, 200),
        severity: 'warn',
        source: 'workflow',
      };
    }
    return {
      ...blocker,
      id: sanitizeRuntimePerceptionText(blocker.id || `blocker-${index + 1}`, 120),
      summary: sanitizeRuntimePerceptionText(blocker.summary, 200),
      source: blocker.source ?? 'workflow',
    };
  });
}

export function buildRuntimeWorkflowState(
  input: BuildRuntimeWorkflowStateInput
): RuntimeWorkflowState {
  const steps = (input.steps ?? []).map(normalizeStep);
  const blockers = normalizeBlockers(input.blockers);
  const running = steps.find((step) => step.status === 'running');
  return {
    ...(input.activePlanId ? { activePlanId: sanitizeRuntimePerceptionText(input.activePlanId, 120) } : {}),
    ...(input.activeRunId ? { activeRunId: sanitizeRuntimePerceptionText(input.activeRunId, 120) } : {}),
    currentStepId: sanitizeRuntimePerceptionText(input.currentStepId || running?.id || '', 120) || undefined,
    hasPlan: Boolean(input.activePlanId || input.activeRunId || steps.length),
    steps,
    blockers,
    pendingConfirmations: input.pendingConfirmations ?? [],
  };
}

export function buildWorkflowCapabilities(workflow: RuntimeWorkflowState): RuntimeCapability[] {
  if (!workflow.hasPlan) {
    return [
      {
        id: 'workflow.create_plan',
        label: 'Create workflow plan',
        source: 'workflow',
        enabled: true,
        risk: 'read',
        targetScope: 'current',
        requiresConfirmation: false,
      },
    ];
  }
  const blocked = workflow.blockers.length > 0 || workflow.steps.some((step) => step.status === 'failed' || step.status === 'blocked');
  return [
    {
      id: 'workflow.inspect_plan',
      label: 'Inspect current workflow plan',
      source: 'workflow',
      enabled: true,
      risk: 'read',
      targetScope: 'current',
      requiresConfirmation: false,
    },
    {
      id: 'workflow.repair_blocker',
      label: 'Repair workflow blocker',
      source: 'workflow',
      enabled: blocked,
      unavailableReason: blocked ? undefined : 'No workflow blocker',
      risk: 'light',
      targetScope: 'current',
      requiresConfirmation: false,
    },
  ];
}
