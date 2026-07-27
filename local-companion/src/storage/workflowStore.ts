/**
 * Companion-side workflow.json — durable canvas structure for a local project.
 * Browser IndexedDB is a cache; when companion is available this file is the source of truth.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectRoot } from './projectPaths.js';
import { assertSafeWorkspaceFolderName } from './safeIds.js';

export const WORKFLOW_SNAPSHOT_FILE = 'workflow.json';
export const WORKFLOW_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type CompanionWorkflowSnapshotV1 = {
  schemaVersion: typeof WORKFLOW_SNAPSHOT_SCHEMA_VERSION;
  projectId: string;
  updatedAt: number;
  /** Opaque workflow bundle (assets/pending/capabilityRefs) — browser-compatible JSON. */
  bundle: {
    assets: unknown[];
    pending: unknown[];
    capabilityRefs?: unknown[];
  };
};

function workflowPath(projectId: string): string {
  const id = assertSafeWorkspaceFolderName(projectId, 'projectId');
  return join(getProjectRoot(id), WORKFLOW_SNAPSHOT_FILE);
}

export function readWorkflowSnapshot(
  projectId: string
): { ok: true; body: CompanionWorkflowSnapshotV1 } | { error: string; code: string } {
  try {
    const id = assertSafeWorkspaceFolderName(projectId, 'projectId');
    const p = workflowPath(id);
    if (!existsSync(p)) {
      return { error: 'workflow_not_found', code: 'STORAGE_NOT_FOUND' };
    }
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<CompanionWorkflowSnapshotV1>;
    if (!raw || typeof raw !== 'object') {
      return { error: 'workflow_invalid', code: 'STORAGE_INVALID' };
    }
    const assets = Array.isArray(raw.bundle?.assets) ? raw.bundle!.assets : [];
    const pending = Array.isArray(raw.bundle?.pending) ? raw.bundle!.pending : [];
    const body: CompanionWorkflowSnapshotV1 = {
      schemaVersion: WORKFLOW_SNAPSHOT_SCHEMA_VERSION,
      projectId: id,
      updatedAt: Number(raw.updatedAt || 0) || Date.now(),
      bundle: {
        assets,
        pending,
        ...(Array.isArray(raw.bundle?.capabilityRefs)
          ? { capabilityRefs: raw.bundle!.capabilityRefs }
          : {}),
      },
    };
    return { ok: true, body };
  } catch {
    return { error: 'invalid_id', code: 'STORAGE_INVALID_ID' };
  }
}

export function writeWorkflowSnapshot(
  projectId: string,
  bundle: CompanionWorkflowSnapshotV1['bundle']
): { ok: true; body: CompanionWorkflowSnapshotV1 } | { error: string; code: string } {
  try {
    const id = assertSafeWorkspaceFolderName(projectId, 'projectId');
    const root = getProjectRoot(id);
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    const body: CompanionWorkflowSnapshotV1 = {
      schemaVersion: WORKFLOW_SNAPSHOT_SCHEMA_VERSION,
      projectId: id,
      updatedAt: Date.now(),
      bundle: {
        assets: Array.isArray(bundle?.assets) ? bundle.assets : [],
        pending: Array.isArray(bundle?.pending) ? bundle.pending : [],
        ...(Array.isArray(bundle?.capabilityRefs) ? { capabilityRefs: bundle.capabilityRefs } : {}),
      },
    };
    const p = workflowPath(id);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(body), 'utf8');
    renameSync(tmp, p);
    return { ok: true, body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('invalid') || msg.includes('SAFE')) {
      return { error: 'invalid_id', code: 'STORAGE_INVALID_ID' };
    }
    return { error: 'workflow_write_failed', code: 'STORAGE_WRITE_FAILED' };
  }
}
