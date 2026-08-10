import { getCompanionLocalBaseUrl } from '../companionLocalPrefs';
import { companionFetchJson } from '../companionClient/fetch';
import type {
  RuntimeExternalAppState,
  RuntimePerceptionRisk,
} from '../../types/runtimePerception';
import {
  buildDisconnectedCompanionExternalApp,
  buildExternalAppPerceptionRisks,
  buildRuntimeExternalAppsFromConnectionPackages,
  type RuntimeConnectionPackageLike,
} from './externalAppAdapter';

export type RuntimeExternalAppSnapshotReadResult = {
  apps: RuntimeExternalAppState[];
  risks: RuntimePerceptionRisk[];
};

type DraftsResponse = {
  drafts?: RuntimeConnectionPackageLike[];
};

type CloudResponse = {
  packages?: RuntimeConnectionPackageLike[];
};

function companionFailureMessage(result: { ok: boolean; error?: string }): string {
  return result.ok ? '' : String(result.error || '').trim();
}

function mergeConnectionPackages(
  drafts: readonly RuntimeConnectionPackageLike[],
  cloudPackages: readonly RuntimeConnectionPackageLike[]
): RuntimeConnectionPackageLike[] {
  const byId = new Map<string, RuntimeConnectionPackageLike>();
  for (const pkg of cloudPackages) {
    const id = String(pkg?.id || '').trim();
    if (id) byId.set(id, pkg);
  }
  for (const pkg of drafts) {
    const id = String(pkg?.id || '').trim();
    if (id) byId.set(id, pkg);
  }
  return Array.from(byId.values());
}

export async function readRuntimeExternalAppSnapshotFromCompanion(
  baseUrl = getCompanionLocalBaseUrl()
): Promise<RuntimeExternalAppSnapshotReadResult> {
  const [draftsResult, cloudResult] = await Promise.all([
    companionFetchJson<DraftsResponse>(baseUrl, '/v1/capability-packages/drafts', { method: 'GET' }),
    companionFetchJson<CloudResponse>(baseUrl, '/v1/capability-packages/cloud', { method: 'GET' }),
  ]);

  if (!draftsResult.ok && !cloudResult.ok) {
    const draftsError = companionFailureMessage(draftsResult);
    const cloudError = companionFailureMessage(cloudResult);
    const app = buildDisconnectedCompanionExternalApp(draftsError || cloudError);
    return { apps: [app], risks: buildExternalAppPerceptionRisks([app]) };
  }

  const packages = mergeConnectionPackages(
    draftsResult.ok && Array.isArray(draftsResult.data.drafts) ? draftsResult.data.drafts : [],
    cloudResult.ok && Array.isArray(cloudResult.data.packages) ? cloudResult.data.packages : []
  );
  const apps = buildRuntimeExternalAppsFromConnectionPackages(packages);
  return { apps, risks: buildExternalAppPerceptionRisks(apps) };
}
