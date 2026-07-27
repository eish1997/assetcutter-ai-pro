/**
 * Sync workflow canvas snapshot with local companion project (workflow.json).
 * When companion is online, a *fresh enough* companion snapshot may replace IDB cache.
 * Never let a sparse/stale companion snapshot wipe a richer local bundle.
 */

import type { WorkflowAsset, WorkflowPendingTask } from '../types';
import { companionFetchJson } from './companionClient/fetch';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import { stripWorkflowBundleForIdbPersist } from './workflowCompanionAssets';
import type { WorkflowProjectBundle } from './workspaceProjectStore';

export type CompanionWorkflowSnapshotV1 = {
  schemaVersion: 1;
  projectId: string;
  updatedAt: number;
  bundle: {
    assets: WorkflowAsset[];
    pending: WorkflowPendingTask[];
    capabilityRefs?: Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }>;
  };
};

export async function fetchCompanionWorkflowSnapshot(
  baseUrl: string,
  projectId: string
): Promise<
  | { ok: true; data: CompanionWorkflowSnapshotV1 }
  | { ok: false; error: string; status?: number; notFound?: boolean }
> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const pid = String(projectId || '').trim();
  if (!base || !pid) return { ok: false, error: 'companion_unavailable' };
  const enc = encodeURIComponent(pid);
  const res = await companionFetchJson<CompanionWorkflowSnapshotV1>(base, `/v1/projects/${enc}/workflow`);
  if (res.ok === false) {
    return {
      ok: false,
      error: res.error,
      status: res.status,
      notFound: res.status === 404 || res.code === 'STORAGE_NOT_FOUND',
    };
  }
  return { ok: true, data: res.data };
}

export async function putCompanionWorkflowSnapshot(
  baseUrl: string,
  projectId: string,
  bundle: {
    assets: WorkflowAsset[];
    pending: WorkflowPendingTask[];
    capabilityRefs?: Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }>;
  }
): Promise<{ ok: true; updatedAt: number } | { ok: false; error: string }> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const pid = String(projectId || '').trim();
  if (!base || !pid || pid === 'default') return { ok: false, error: 'companion_unavailable' };

  const stripped = stripWorkflowBundleForIdbPersist({
    assets: bundle.assets,
    pending: bundle.pending,
    ...(bundle.capabilityRefs ? { capabilityRefs: bundle.capabilityRefs } : {}),
  } as WorkflowProjectBundle);

  const enc = encodeURIComponent(pid);
  const res = await companionFetchJson<{ ok: true; workflow: CompanionWorkflowSnapshotV1 }>(
    base,
    `/v1/projects/${enc}/workflow`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assets: stripped.assets,
        pending: stripped.pending,
        ...(stripped.capabilityRefs ? { capabilityRefs: stripped.capabilityRefs } : {}),
      }),
    }
  );
  if (res.ok === false) return { ok: false, error: res.error };
  return { ok: true, updatedAt: Number(res.data.workflow?.updatedAt || Date.now()) };
}

function cloneLocalBundle(local: WorkflowProjectBundle | null | undefined): WorkflowProjectBundle | null {
  if (!local) return null;
  return {
    assets: local.assets || [],
    pending: local.pending || [],
    ...(local.capabilityRefs ? { capabilityRefs: local.capabilityRefs } : {}),
  };
}

function cloneCompanionBundle(companion: CompanionWorkflowSnapshotV1): WorkflowProjectBundle {
  const assets = Array.isArray(companion.bundle.assets) ? companion.bundle.assets : [];
  const pending = Array.isArray(companion.bundle.pending) ? companion.bundle.pending : [];
  return {
    assets: assets as WorkflowAsset[],
    pending: pending as WorkflowPendingTask[],
    ...(Array.isArray(companion.bundle.capabilityRefs)
      ? {
          capabilityRefs: companion.bundle.capabilityRefs as WorkflowProjectBundle['capabilityRefs'],
        }
      : {}),
  };
}

/**
 * Choose companion vs local IDB without data-loss:
 * - empty local → companion (even if companion empty)
 * - companion has no assets while local has assets → keep local (pending-only must not wipe canvas)
 * - companion has fewer assets than local → keep local unless companion is strictly newer by updatedAt
 * - otherwise prefer companion when it has assets and is not clearly poorer
 */
export function preferCompanionWorkflowBundle(params: {
  local: WorkflowProjectBundle | null | undefined;
  companion: CompanionWorkflowSnapshotV1 | null | undefined;
  /** Optional local mtime (ms). When omitted, asset-count guard alone prevents wipe. */
  localUpdatedAt?: number | null;
}): WorkflowProjectBundle | null {
  const local = params.local;
  const companion = params.companion;
  if (!companion?.bundle) return cloneLocalBundle(local);

  const companionBundle = cloneCompanionBundle(companion);
  const localAssets = local?.assets?.length || 0;
  const localPending = local?.pending?.length || 0;
  const localCount = localAssets + localPending;
  const cAssets = companionBundle.assets.length;
  const cPending = companionBundle.pending.length;

  if (localCount === 0) return companionBundle;

  // Never replace a canvas that has assets with a companion snapshot that has none.
  if (localAssets > 0 && cAssets === 0) return cloneLocalBundle(local);

  // Companion poorer in assets: only take it if explicitly newer.
  const localUpdatedAt = Number(params.localUpdatedAt || 0);
  const companionUpdatedAt = Number(companion.updatedAt || 0);
  if (cAssets < localAssets) {
    if (companionUpdatedAt > 0 && localUpdatedAt > 0 && companionUpdatedAt > localUpdatedAt) {
      return companionBundle;
    }
    return cloneLocalBundle(local);
  }

  // Equal or richer companion asset set → prefer companion (source of truth when healthy).
  if (cAssets > 0 || (cPending > 0 && localAssets === 0)) {
    return companionBundle;
  }

  return cloneLocalBundle(local);
}
