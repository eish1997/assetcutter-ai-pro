import type { WorkflowPin, WorkflowPinScope, WorkflowVersionPolicy } from './workflowObjects.js';
import { loadWorkflowObjectStore, saveWorkflowObjectStore, upsertWorkflowPin } from './workflowObjectStore.js';

export type WorkflowPinResult =
  | { ok: true; pin: WorkflowPin }
  | { ok: false; error: string; message: string };

export function listWorkflowPins(input: {
  scope?: WorkflowPinScope['kind'];
  storePath?: string;
} = {}) {
  const pins = loadWorkflowObjectStore(input.storePath).pins;
  return input.scope ? pins.filter((pin) => pin.scope.kind === input.scope) : pins;
}

export function createWorkflowPin(input: {
  createdAt?: string;
  pinId?: string;
  scope: WorkflowPinScope;
  sortOrder?: number;
  storePath?: string;
  versionPolicy?: WorkflowVersionPolicy;
  workflowId: string;
}): WorkflowPinResult {
  const snapshot = loadWorkflowObjectStore(input.storePath);
  const definition = snapshot.definitions.find((item) => item.id === input.workflowId);
  if (!definition) {
    return {
      ok: false,
      error: 'workflow_definition_not_found',
      message: `WorkflowDefinition not found: ${input.workflowId}`,
    };
  }
  const versionPolicy = input.versionPolicy ?? { kind: 'follow_default' };
  if (versionPolicy.kind === 'locked') {
    const versionExists = snapshot.versions.some((item) => item.id === versionPolicy.version_id && item.workflow_id === input.workflowId);
    if (!versionExists) {
      return {
        ok: false,
        error: 'workflow_version_not_found',
        message: `WorkflowVersion not found: ${versionPolicy.version_id}`,
      };
    }
  }
  const pin: WorkflowPin = {
    created_at: input.createdAt ?? new Date().toISOString(),
    id: input.pinId ?? `pin_${input.workflowId.replaceAll('.', '_')}_${input.scope.kind}`,
    scope: input.scope,
    sort_order: input.sortOrder ?? 0,
    version_policy: versionPolicy,
    workflow_id: input.workflowId,
  };
  upsertWorkflowPin(pin, input.storePath);
  return { ok: true, pin };
}

export function deleteWorkflowPin(input: {
  pinId: string;
  storePath?: string;
}) {
  const snapshot = loadWorkflowObjectStore(input.storePath);
  const exists = snapshot.pins.some((pin) => pin.id === input.pinId);
  if (!exists) {
    return {
      ok: false as const,
      error: 'workflow_pin_not_found',
      message: `WorkflowPin not found: ${input.pinId}`,
    };
  }
  const saved = saveWorkflowObjectStore({
    ...snapshot,
    pins: snapshot.pins.filter((pin) => pin.id !== input.pinId),
  }, input.storePath);
  return {
    ok: true as const,
    pins: saved.pins,
  };
}
