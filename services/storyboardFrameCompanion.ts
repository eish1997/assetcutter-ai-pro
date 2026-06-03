import type { StoryboardNamedAssetCompanionHydrateTask } from './storyboardNamedAssetImage';
import {
  applyStoryboardNamedAssetCompanionHydrate,
  listStoryboardNamedAssetCompanionHydrateTasks as listNamedAssetCompanionHydrateTasksForTable,
} from './storyboardNamedAssetImage';
import {
  companionRasterSlotNeedsHydrate,
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  putWorkflowResultImageToCompanion,
  shouldKeepExistingCompanionRasterUrl,
} from './workflowCompanionAssets';
import {
  isWorkflowStoryboardTableAsset,
  normalizeStoryboardTableOnAsset,
} from './storyboardTableAsset';
import type { StoryboardTableRow, WorkflowAsset } from '../types';

export const STORYBOARD_FRAME_COMPANION_HYDRATE_CONCURRENCY = 8;

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const out = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) break;
        out[i] = await mapper(items[i]!, i);
      }
    })
  );
  return out;
}

export type StoryboardFrameCompanionHydrateTask = {
  assetId: string;
  rowId: string;
  companionKey: string;
  prevImg: string;
};

export type StoryboardFrameHistoryCompanionHydrateTask = {
  assetId: string;
  rowId: string;
  versionId: string;
  companionKey: string;
  prevImg: string;
};

export type StoryboardFrameCompanionHydrateFailure = {
  task: StoryboardFrameCompanionHydrateTask | StoryboardFrameHistoryCompanionHydrateTask;
  error: string;
  kind: 'frame' | 'history';
};

export function listStoryboardFrameCompanionHydrateTasks(
  assets: WorkflowAsset[]
): StoryboardFrameCompanionHydrateTask[] {
  const tasks: StoryboardFrameCompanionHydrateTask[] = [];
  for (const asset of assets) {
    if (!isWorkflowStoryboardTableAsset(asset)) continue;
    for (const row of asset.storyboardTable?.rows ?? []) {
      const companionKey = String(row.frameImageCompanionKey || '').trim();
      if (!companionKey) continue;
      tasks.push({
        assetId: asset.id,
        rowId: row.id,
        companionKey,
        prevImg: String(row.frameImage || '').trim(),
      });
    }
  }
  return tasks;
}

export function listStoryboardFrameHistoryCompanionHydrateTasks(
  assets: WorkflowAsset[]
): StoryboardFrameHistoryCompanionHydrateTask[] {
  const tasks: StoryboardFrameHistoryCompanionHydrateTask[] = [];
  for (const asset of assets) {
    if (!isWorkflowStoryboardTableAsset(asset)) continue;
    for (const row of asset.storyboardTable?.rows ?? []) {
      for (const ver of row.frameImageHistory ?? []) {
        const companionKey = String(ver.frameImageCompanionKey || '').trim();
        if (!companionKey) continue;
        tasks.push({
          assetId: asset.id,
          rowId: row.id,
          versionId: ver.id,
          companionKey,
          prevImg: String(ver.frameImage || '').trim(),
        });
      }
    }
  }
  return tasks;
}

export function buildStoryboardFrameCompanionHydrateKey(assets: WorkflowAsset[]): string {
  return listStoryboardFrameCompanionHydrateTasks(assets)
    .map((task) => `${task.assetId}:${task.rowId}:${task.companionKey}`)
    .sort()
    .join('|');
}

export function buildStoryboardFrameHistoryCompanionHydrateKey(assets: WorkflowAsset[]): string {
  return listStoryboardFrameHistoryCompanionHydrateTasks(assets)
    .map((task) => `${task.assetId}:${task.rowId}:${task.versionId}:${task.companionKey}`)
    .sort()
    .join('|');
}

export async function hydrateStoryboardFrameCompanionTasks(
  tasks: StoryboardFrameCompanionHydrateTask[],
  companionBaseUrl: string,
  companionProjectId: string,
  options?: { concurrency?: number }
): Promise<{
  hydrated: Array<{ task: StoryboardFrameCompanionHydrateTask; objectUrl: string }>;
  failures: StoryboardFrameCompanionHydrateFailure[];
}> {
  const base = String(companionBaseUrl || '').trim();
  const pid = String(companionProjectId || '').trim();
  const concurrency = options?.concurrency ?? STORYBOARD_FRAME_COMPANION_HYDRATE_CONCURRENCY;
  const eligible: StoryboardFrameCompanionHydrateTask[] = [];
  for (const task of tasks) {
    if (await shouldKeepExistingCompanionRasterUrl(task.prevImg, task.companionKey)) continue;
    eligible.push(task);
  }
  if (!eligible.length || !base || !pid) {
    return { hydrated: [], failures: [] };
  }

  const outcomes = await mapLimit(eligible, concurrency, async (task) => {
    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, task.companionKey);
    if (got.ok === false) {
      return { task, error: got.error } as const;
    }
    return { task, objectUrl: got.objectUrl } as const;
  });

  const hydrated: Array<{ task: StoryboardFrameCompanionHydrateTask; objectUrl: string }> = [];
  const failures: StoryboardFrameCompanionHydrateFailure[] = [];
  for (const outcome of outcomes) {
    if ('objectUrl' in outcome) {
      hydrated.push(outcome);
    } else {
      failures.push({ ...outcome, kind: 'frame' });
    }
  }
  return { hydrated, failures };
}

export async function hydrateStoryboardFrameHistoryCompanionTasks(
  tasks: StoryboardFrameHistoryCompanionHydrateTask[],
  companionBaseUrl: string,
  companionProjectId: string,
  options?: { concurrency?: number }
): Promise<{
  hydrated: Array<{ task: StoryboardFrameHistoryCompanionHydrateTask; objectUrl: string }>;
  failures: StoryboardFrameCompanionHydrateFailure[];
}> {
  const base = String(companionBaseUrl || '').trim();
  const pid = String(companionProjectId || '').trim();
  const concurrency = options?.concurrency ?? STORYBOARD_FRAME_COMPANION_HYDRATE_CONCURRENCY;
  const eligible: StoryboardFrameHistoryCompanionHydrateTask[] = [];
  for (const task of tasks) {
    if (await shouldKeepExistingCompanionRasterUrl(task.prevImg, task.companionKey)) continue;
    eligible.push(task);
  }
  if (!eligible.length || !base || !pid) {
    return { hydrated: [], failures: [] };
  }

  const outcomes = await mapLimit(eligible, concurrency, async (task) => {
    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, task.companionKey);
    if (got.ok === false) {
      return { task, error: got.error } as const;
    }
    return { task, objectUrl: got.objectUrl } as const;
  });

  const hydrated: Array<{ task: StoryboardFrameHistoryCompanionHydrateTask; objectUrl: string }> = [];
  const failures: StoryboardFrameCompanionHydrateFailure[] = [];
  for (const outcome of outcomes) {
    if ('objectUrl' in outcome) {
      hydrated.push(outcome);
    } else {
      failures.push({ ...outcome, kind: 'history' });
    }
  }
  return { hydrated, failures };
}

function revokeStoryboardFrameBlobUrl(url: string): void {
  if (!/^blob:/i.test(String(url || '').trim())) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

export function applyStoryboardFrameCompanionHydrateResults(
  assets: WorkflowAsset[],
  hydrated: Array<{ task: StoryboardFrameCompanionHydrateTask; objectUrl: string }>
): WorkflowAsset[] {
  if (!hydrated.length) return assets;
  const byAsset = new Map<string, Map<string, string>>();
  for (const { task, objectUrl } of hydrated) {
    let rowMap = byAsset.get(task.assetId);
    if (!rowMap) {
      rowMap = new Map();
      byAsset.set(task.assetId, rowMap);
    }
    rowMap.set(task.rowId, objectUrl);
  }

  return assets.map((asset) => {
    const rowMap = byAsset.get(asset.id);
    if (!rowMap || !isWorkflowStoryboardTableAsset(asset) || !asset.storyboardTable?.rows) {
      return asset;
    }
    return normalizeStoryboardTableOnAsset({
      ...asset,
      storyboardTable: {
        ...asset.storyboardTable,
        rows: asset.storyboardTable.rows.map((row) => {
          const objectUrl = rowMap.get(row.id);
          if (!objectUrl) return row;
          revokeStoryboardFrameBlobUrl(String(row.frameImage || '').trim());
          return { ...row, frameImage: objectUrl };
        }),
      },
    });
  });
}

export function applyStoryboardFrameHistoryCompanionHydrateResults(
  assets: WorkflowAsset[],
  hydrated: Array<{ task: StoryboardFrameHistoryCompanionHydrateTask; objectUrl: string }>
): WorkflowAsset[] {
  if (!hydrated.length) return assets;
  const byAsset = new Map<string, Map<string, Map<string, string>>>();
  for (const { task, objectUrl } of hydrated) {
    let rowMap = byAsset.get(task.assetId);
    if (!rowMap) {
      rowMap = new Map();
      byAsset.set(task.assetId, rowMap);
    }
    let versionMap = rowMap.get(task.rowId);
    if (!versionMap) {
      versionMap = new Map();
      rowMap.set(task.rowId, versionMap);
    }
    versionMap.set(task.versionId, objectUrl);
  }

  return assets.map((asset) => {
    const rowMap = byAsset.get(asset.id);
    if (!rowMap || !isWorkflowStoryboardTableAsset(asset) || !asset.storyboardTable?.rows) {
      return asset;
    }
    return normalizeStoryboardTableOnAsset({
      ...asset,
      storyboardTable: {
        ...asset.storyboardTable,
        rows: asset.storyboardTable.rows.map((row) => {
          const versionMap = rowMap.get(row.id);
          if (!versionMap || !row.frameImageHistory?.length) return row;
          return {
            ...row,
            frameImageHistory: row.frameImageHistory.map((item) => {
              const objectUrl = versionMap.get(item.id);
              if (!objectUrl) return item;
              revokeStoryboardFrameBlobUrl(String(item.frameImage || '').trim());
              return { ...item, frameImage: objectUrl };
            }),
          };
        }),
      },
    });
  });
}

export function revokeStoryboardFrameCompanionHydrateUrls(
  hydrated: Array<{ objectUrl: string }>
): void {
  for (const item of hydrated) {
    revokeStoryboardFrameBlobUrl(item.objectUrl);
  }
}

export function storyboardFrameCompanionResultKey(rowId: string): string {
  return `storyboard-frame-${rowId}`;
}

export type PersistStoryboardFrameOpts = {
  dataUrl: string;
  assetId: string;
  rowId: string;
  companionBaseUrl: string;
  companionProjectId: string;
};

/** 分镜图落本地伴侣，成功后可清空行内 data URL 以减轻 IDB / 同步体积 */
export async function persistStoryboardFrameToCompanion(
  opts: PersistStoryboardFrameOpts
): Promise<{ ok: true; companionKey: string } | { ok: false }> {
  const base = String(opts.companionBaseUrl || '').trim();
  const pid = String(opts.companionProjectId || '').trim();
  if (!base || !pid) return { ok: false };

  const put = await putWorkflowResultImageToCompanion(
    base,
    pid,
    opts.assetId,
    storyboardFrameCompanionResultKey(opts.rowId),
    opts.dataUrl
  );
  if (!put.ok) return { ok: false };
  return { ok: true, companionKey: put.key };
}

export type StoryboardFrameRowPatch = Pick<
  StoryboardTableRow,
  'frameImage' | 'frameImageObjectKey' | 'frameImageCompanionKey'
>;

/** 落伴侣并立即拉 blob 供 UI 显示；失败时保留 data URL */
export async function persistStoryboardFrameImage(
  opts: PersistStoryboardFrameOpts
): Promise<StoryboardFrameRowPatch> {
  const dataUrl = opts.dataUrl;
  const persisted = await persistStoryboardFrameToCompanion(opts);
  if (!persisted.ok) {
    return {
      frameImage: dataUrl,
      frameImageObjectKey: undefined,
      frameImageCompanionKey: undefined,
    };
  }
  const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(
    opts.companionBaseUrl,
    opts.companionProjectId,
    persisted.companionKey
  );
  if (got.ok) {
    return {
      frameImage: got.objectUrl,
      frameImageObjectKey: undefined,
      frameImageCompanionKey: persisted.companionKey,
    };
  }
  return {
    frameImage: dataUrl,
    frameImageObjectKey: undefined,
    frameImageCompanionKey: persisted.companionKey,
  };
}

export function storyboardRowNeedsCompanionFrameHydrate(row: StoryboardTableRow): boolean {
  if (String(row.frameImageObjectKey || '').trim()) return false;
  return companionRasterSlotNeedsHydrate(
    String(row.frameImage || ''),
    String(row.frameImageCompanionKey || '')
  );
}

export function storyboardTableHasCompanionFrameHydrateGaps(
  rows: StoryboardTableRow[] | undefined
): boolean {
  if (!rows?.length) return false;
  return rows.some(storyboardRowNeedsCompanionFrameHydrate);
}

export function listStoryboardNamedAssetCompanionHydrateTasks(
  assets: WorkflowAsset[]
): StoryboardNamedAssetCompanionHydrateTask[] {
  const tasks: StoryboardNamedAssetCompanionHydrateTask[] = [];
  for (const asset of assets) {
    if (!isWorkflowStoryboardTableAsset(asset)) continue;
    tasks.push(
      ...listNamedAssetCompanionHydrateTasksForTable(asset.id, 'role', asset.storyboardTable?.roleAssets),
      ...listNamedAssetCompanionHydrateTasksForTable(asset.id, 'scene', asset.storyboardTable?.sceneAssets)
    );
  }
  return tasks;
}

export function buildStoryboardNamedAssetCompanionHydrateKey(assets: WorkflowAsset[]): string {
  return listStoryboardNamedAssetCompanionHydrateTasks(assets)
    .map((task) => `${task.tableAssetId}:${task.kind}:${task.namedAssetId}:${task.companionKey}`)
    .sort()
    .join('|');
}

export async function hydrateStoryboardNamedAssetCompanionTasks(
  tasks: StoryboardNamedAssetCompanionHydrateTask[],
  companionBaseUrl: string,
  companionProjectId: string,
  options?: { concurrency?: number }
): Promise<{
  hydrated: Array<{ task: StoryboardNamedAssetCompanionHydrateTask; objectUrl: string }>;
  failures: Array<{ task: StoryboardNamedAssetCompanionHydrateTask; error: string }>;
}> {
  const base = String(companionBaseUrl || '').trim();
  const pid = String(companionProjectId || '').trim();
  const concurrency = options?.concurrency ?? STORYBOARD_FRAME_COMPANION_HYDRATE_CONCURRENCY;
  const eligible: StoryboardNamedAssetCompanionHydrateTask[] = [];
  for (const task of tasks) {
    if (await shouldKeepExistingCompanionRasterUrl(task.prevImg, task.companionKey)) continue;
    eligible.push(task);
  }
  if (!eligible.length || !base || !pid) {
    return { hydrated: [], failures: [] };
  }

  const outcomes = await mapLimit(eligible, concurrency, async (task) => {
    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, task.companionKey);
    if (got.ok === false) {
      return { task, error: got.error } as const;
    }
    return { task, objectUrl: got.objectUrl } as const;
  });

  const hydrated: Array<{ task: StoryboardNamedAssetCompanionHydrateTask; objectUrl: string }> = [];
  const failures: Array<{ task: StoryboardNamedAssetCompanionHydrateTask; error: string }> = [];
  for (const outcome of outcomes) {
    if ('objectUrl' in outcome) {
      hydrated.push(outcome);
    } else {
      failures.push(outcome);
    }
  }
  return { hydrated, failures };
}

export function applyStoryboardNamedAssetCompanionHydrateResults(
  assets: WorkflowAsset[],
  hydrated: Array<{ task: StoryboardNamedAssetCompanionHydrateTask; objectUrl: string }>
): WorkflowAsset[] {
  if (!hydrated.length) return assets;
  const byTable = new Map<string, Array<{ task: StoryboardNamedAssetCompanionHydrateTask; objectUrl: string }>>();
  for (const item of hydrated) {
    const list = byTable.get(item.task.tableAssetId) ?? [];
    list.push(item);
    byTable.set(item.task.tableAssetId, list);
  }
  return assets.map((asset) => {
    const batch = byTable.get(asset.id);
    if (!batch?.length || !isWorkflowStoryboardTableAsset(asset) || !asset.storyboardTable) return asset;
    let roleAssets = asset.storyboardTable.roleAssets;
    let sceneAssets = asset.storyboardTable.sceneAssets;
    for (const { task, objectUrl } of batch) {
      if (task.kind === 'role') {
        roleAssets = applyStoryboardNamedAssetCompanionHydrate(roleAssets, task.namedAssetId, objectUrl);
      } else {
        sceneAssets = applyStoryboardNamedAssetCompanionHydrate(sceneAssets, task.namedAssetId, objectUrl);
      }
    }
    return {
      ...asset,
      storyboardTable: {
        ...asset.storyboardTable,
        ...(roleAssets?.length ? { roleAssets } : {}),
        ...(sceneAssets?.length ? { sceneAssets } : {}),
      },
    };
  });
}
