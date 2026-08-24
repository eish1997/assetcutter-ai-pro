import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  WorkflowDefinition,
  WorkflowDraft,
  WorkflowPin,
  WorkflowRepairSession,
  WorkflowVersion,
} from './workflowObjects.js';

export const workflowObjectStoreSchemaVersion = 1;

export type WorkflowObjectStoreSnapshot = {
  definitions: WorkflowDefinition[];
  drafts: WorkflowDraft[];
  pins: WorkflowPin[];
  repair_sessions: WorkflowRepairSession[];
  saved_at?: string;
  schema_version: typeof workflowObjectStoreSchemaVersion;
  versions: WorkflowVersion[];
};

const defaultWorkflowObjectStorePath = path.resolve('.assetcutter/workflow-runtime/workflow-objects.json');
let memorySnapshot = createEmptyWorkflowObjectStoreSnapshot();

export function getDefaultWorkflowObjectStorePath() {
  return defaultWorkflowObjectStorePath;
}

export function createEmptyWorkflowObjectStoreSnapshot(): WorkflowObjectStoreSnapshot {
  return {
    definitions: [],
    drafts: [],
    pins: [],
    repair_sessions: [],
    schema_version: workflowObjectStoreSchemaVersion,
    versions: [],
  };
}

export function loadWorkflowObjectStore(storePath = defaultWorkflowObjectStorePath): WorkflowObjectStoreSnapshot {
  if (!existsSync(storePath)) {
    return path.resolve(storePath) === defaultWorkflowObjectStorePath
      ? memorySnapshot
      : createEmptyWorkflowObjectStoreSnapshot();
  }

  try {
    return normalizeWorkflowObjectStoreSnapshot(JSON.parse(readFileSync(storePath, 'utf8')) as unknown);
  } catch {
    return createEmptyWorkflowObjectStoreSnapshot();
  }
}

export function saveWorkflowObjectStore(
  snapshot: WorkflowObjectStoreSnapshot,
  storePath = defaultWorkflowObjectStorePath,
) {
  const normalized = normalizeWorkflowObjectStoreSnapshot(snapshot);
  const withSavedAt = {
    ...normalized,
    saved_at: new Date().toISOString(),
  };

  memorySnapshot = withSavedAt;
  persistWorkflowObjectStore(withSavedAt, storePath);
  return withSavedAt;
}

export function clearWorkflowObjectStore(storePath = defaultWorkflowObjectStorePath) {
  return saveWorkflowObjectStore(createEmptyWorkflowObjectStoreSnapshot(), storePath);
}

export function upsertWorkflowDefinition(
  definition: WorkflowDefinition,
  storePath = defaultWorkflowObjectStorePath,
) {
  const snapshot = loadWorkflowObjectStore(storePath);
  return saveWorkflowObjectStore({
    ...snapshot,
    definitions: upsertById(snapshot.definitions, definition),
  }, storePath);
}

export function upsertWorkflowVersion(
  version: WorkflowVersion,
  storePath = defaultWorkflowObjectStorePath,
) {
  const snapshot = loadWorkflowObjectStore(storePath);
  return saveWorkflowObjectStore({
    ...snapshot,
    versions: upsertById(snapshot.versions, version),
  }, storePath);
}

export function upsertWorkflowDraft(
  draft: WorkflowDraft,
  storePath = defaultWorkflowObjectStorePath,
) {
  const snapshot = loadWorkflowObjectStore(storePath);
  return saveWorkflowObjectStore({
    ...snapshot,
    drafts: upsertById(snapshot.drafts, draft),
  }, storePath);
}

export function upsertWorkflowPin(
  pin: WorkflowPin,
  storePath = defaultWorkflowObjectStorePath,
) {
  const snapshot = loadWorkflowObjectStore(storePath);
  return saveWorkflowObjectStore({
    ...snapshot,
    pins: upsertById(snapshot.pins, pin),
  }, storePath);
}

export function upsertWorkflowRepairSession(
  repairSession: WorkflowRepairSession,
  storePath = defaultWorkflowObjectStorePath,
) {
  const snapshot = loadWorkflowObjectStore(storePath);
  return saveWorkflowObjectStore({
    ...snapshot,
    repair_sessions: upsertById(snapshot.repair_sessions, repairSession),
  }, storePath);
}

function persistWorkflowObjectStore(snapshot: WorkflowObjectStoreSnapshot, storePath: string) {
  const dir = path.dirname(storePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${storePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
  renameSync(tmp, storePath);
}

function normalizeWorkflowObjectStoreSnapshot(input: unknown): WorkflowObjectStoreSnapshot {
  if (!isRecord(input)) return createEmptyWorkflowObjectStoreSnapshot();

  return {
    definitions: Array.isArray(input.definitions) ? input.definitions as WorkflowDefinition[] : [],
    drafts: Array.isArray(input.drafts) ? input.drafts as WorkflowDraft[] : [],
    pins: Array.isArray(input.pins) ? input.pins as WorkflowPin[] : [],
    repair_sessions: Array.isArray(input.repair_sessions) ? input.repair_sessions as WorkflowRepairSession[] : [],
    saved_at: typeof input.saved_at === 'string' ? input.saved_at : undefined,
    schema_version: workflowObjectStoreSchemaVersion,
    versions: Array.isArray(input.versions) ? input.versions as WorkflowVersion[] : [],
  };
}

function upsertById<T extends { id: string }>(items: T[], item: T) {
  return [
    item,
    ...items.filter((candidate) => candidate.id !== item.id),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
