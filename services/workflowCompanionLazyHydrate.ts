import type { WorkflowAsset } from '../types';
import { isWorkflowTextAsset } from './workflowTextAsset';
import {
  companionRasterSlotNeedsHydrate,
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  shouldKeepExistingCompanionRasterUrl,
} from './workflowCompanionAssets';

export const WORKFLOW_COMPANION_LAZY_HYDRATE_MAX_PARALLEL = 4;
export const WORKFLOW_COMPANION_LAZY_HYDRATE_BATCH_MS = 48;

export type WorkflowCompanionHydratePatch =
  | { assetId: string; kind: 'original'; objectUrl: string }
  | { assetId: string; kind: 'result'; stepId: string; objectUrl: string };

export type WorkflowCompanionLazyHydrateTask = {
  assetId: string;
  kind: 'original' | 'result';
  stepId?: string;
  companionKey: string;
  priority: number;
};

function buildCompanionLazyHydrateTasks(
  assets: WorkflowAsset[],
  visibleAssetIds: Set<string>
): WorkflowCompanionLazyHydrateTask[] {
  const tasks: WorkflowCompanionLazyHydrateTask[] = [];

  for (const a of assets) {
    const inView = visibleAssetIds.has(a.id);
    const priority = inView ? 0 : 1;
    const origKey = String(a.originalCompanionKey || '').trim();
    const orig = String(a.original || '').trim();
    if (
      origKey &&
      !isWorkflowTextAsset(a) &&
      (companionRasterSlotNeedsHydrate(orig, origKey) || /^blob:/i.test(orig))
    ) {
      tasks.push({ assetId: a.id, kind: 'original', companionKey: origKey, priority });
    }
    const rck = a.resultsCompanionKeys || {};
    const res = a.results || {};
    for (const stepId of Object.keys(rck)) {
      const ck = String(rck[stepId] || '').trim();
      if (!ck) continue;
      const val = String(res[stepId] ?? '').trim();
      if (companionRasterSlotNeedsHydrate(val, ck) || /^blob:/i.test(val)) {
        tasks.push({ assetId: a.id, kind: 'result', stepId, companionKey: ck, priority });
      }
    }
  }

  return tasks.sort((x, y) => x.priority - y.priority);
}

function applyCompanionHydratePatches(
  assets: WorkflowAsset[],
  patches: WorkflowCompanionHydratePatch[]
): WorkflowAsset[] {
  if (!patches.length) return assets;
  const byAsset = new Map<string, WorkflowCompanionHydratePatch[]>();
  for (const p of patches) {
    const list = byAsset.get(p.assetId) ?? [];
    list.push(p);
    byAsset.set(p.assetId, list);
  }
  return assets.map((x) => {
    const ps = byAsset.get(x.id);
    if (!ps?.length) return x;
    let next = x;
    for (const p of ps) {
      if (p.kind === 'original') {
        const prevO = String(next.original || '').trim();
        if (/^blob:/i.test(prevO)) {
          try {
            URL.revokeObjectURL(prevO);
          } catch {
            /* ignore */
          }
        }
        next = { ...next, original: p.objectUrl };
      } else {
        const prevV = String((next.results || {})[p.stepId] ?? '').trim();
        if (/^blob:/i.test(prevV)) {
          try {
            URL.revokeObjectURL(prevV);
          } catch {
            /* ignore */
          }
        }
        next = {
          ...next,
          results: { ...(next.results || {}), [p.stepId]: p.objectUrl },
        };
      }
    }
    return next;
  });
}

export type RunWorkflowCompanionLazyHydrateOpts = {
  projectId: string;
  companionBaseUrl: string;
  /** 每次执行任务前读取最新 assets，避免快照过期或重复拉取 */
  getAssets: () => WorkflowAsset[];
  visibleAssetIds: Set<string>;
  maxParallel?: number;
  onPatch: (patches: WorkflowCompanionHydratePatch[]) => void;
  onFailure?: (task: WorkflowCompanionLazyHydrateTask, error: string) => void;
  isCancelled?: () => boolean;
};

/** 视口优先、并发受限、批量回调的伴侣原图/结果图 hydrate（替代整页 eager 循环） */
export async function runWorkflowCompanionLazyHydrate(
  opts: RunWorkflowCompanionLazyHydrateOpts
): Promise<void> {
  const {
    projectId,
    companionBaseUrl,
    getAssets,
    visibleAssetIds,
    maxParallel = WORKFLOW_COMPANION_LAZY_HYDRATE_MAX_PARALLEL,
    onPatch,
    onFailure,
    isCancelled,
  } = opts;
  const base = String(companionBaseUrl || '').trim();
  const pid = String(projectId || '').trim();
  if (!base || !pid) return;

  const tasks = buildCompanionLazyHydrateTasks(getAssets(), visibleAssetIds);
  if (!tasks.length) return;

  let cursor = 0;
  const pendingPatches: WorkflowCompanionHydratePatch[] = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (!pendingPatches.length) return;
    const batch = pendingPatches.splice(0, pendingPatches.length);
    onPatch(batch);
  };

  const scheduleFlush = () => {
    if (batchTimer != null) return;
    batchTimer = setTimeout(() => {
      batchTimer = null;
      flush();
    }, WORKFLOW_COMPANION_LAZY_HYDRATE_BATCH_MS);
  };

  const runOne = async (task: WorkflowCompanionLazyHydrateTask) => {
    if (isCancelled?.()) return;
    const asset = getAssets().find((a) => a.id === task.assetId);
    if (!asset) return;

    if (task.kind === 'original') {
      const prevO = String(asset.original || '').trim();
      if (await shouldKeepExistingCompanionRasterUrl(prevO, task.companionKey)) return;
    } else {
      if (!task.stepId) return;
      const prevV = String(asset.results?.[task.stepId] ?? '').trim();
      if (await shouldKeepExistingCompanionRasterUrl(prevV, task.companionKey)) return;
    }

    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, task.companionKey);
    if (isCancelled?.()) {
      if (got.ok) URL.revokeObjectURL(got.objectUrl);
      return;
    }
    if (got.ok === false) {
      onFailure?.(task, got.error);
      return;
    }

    if (task.kind === 'original') {
      pendingPatches.push({ assetId: task.assetId, kind: 'original', objectUrl: got.objectUrl });
    } else if (task.stepId) {
      pendingPatches.push({
        assetId: task.assetId,
        kind: 'result',
        stepId: task.stepId,
        objectUrl: got.objectUrl,
      });
    }
    scheduleFlush();
  };

  const workers = Array.from({ length: Math.max(1, maxParallel) }, async () => {
    while (cursor < tasks.length) {
      if (isCancelled?.()) return;
      const task = tasks[cursor++];
      if (!task) return;
      await runOne(task);
    }
  });

  await Promise.all(workers);
  if (batchTimer != null) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  flush();
}

export { applyCompanionHydratePatches, buildCompanionLazyHydrateTasks };

/** 项目打开时稳定：仅含 projectId + 各资产伴侣键，不随 hydrate 填 blob 而变 */
export function buildCompanionHydrateSessionKey(projectId: string, assets: WorkflowAsset[]): string {
  const parts: string[] = [String(projectId || '').trim()];
  for (const a of assets) {
    const ok = String(a.originalCompanionKey || '').trim();
    if (ok) parts.push(`${a.id}:o:${ok}`);
    const rck = a.resultsCompanionKeys || {};
    for (const sid of Object.keys(rck).sort()) {
      const ck = String(rck[sid] || '').trim();
      if (ck) parts.push(`${a.id}:r:${sid}:${ck}`);
    }
  }
  return parts.join('\0');
}

export async function runWorkflowCompanionEagerRasterHydrate(opts: {
  projectId: string;
  companionBaseUrl: string;
  getAssets: () => WorkflowAsset[];
  onPatch: (patches: WorkflowCompanionHydratePatch[]) => void;
  onFailure?: (task: WorkflowCompanionLazyHydrateTask, error: string) => void;
  isCancelled?: () => boolean;
}): Promise<void> {
  const allIds = new Set(opts.getAssets().map((a) => a.id));
  await runWorkflowCompanionLazyHydrate({
    ...opts,
    visibleAssetIds: allIds,
    maxParallel: WORKFLOW_COMPANION_LAZY_HYDRATE_MAX_PARALLEL,
  });
}
