import {
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  shouldKeepExistingCompanionRasterUrl,
} from '../workflowCompanionAssets';
import {
  storyboardCompanionHydrateSlotSignature,
  STORYBOARD_FRAME_COMPANION_HYDRATE_CONCURRENCY,
} from '../storyboardFrameCompanion';
import type { WorkflowAsset } from '../../types';
import { isWorkflowAssetSetAsset, normalizeAssetSetOnAsset } from './assetSetAsset';

export type AssetSetCompanionHydrateSlot =
  | { kind: 'source'; sourceId: string }
  | { kind: 'crop'; componentId: string }
  | { kind: 'sheet'; componentId: string }
  | { kind: 'view'; componentId: string; viewId: string };

export type AssetSetCompanionHydrateTask = {
  assetId: string;
  slot: AssetSetCompanionHydrateSlot;
  companionKey: string;
  prevImg: string;
};

function slotTaskKey(task: AssetSetCompanionHydrateTask): string {
  const s = task.slot;
  if (s.kind === 'source') return `source:${s.sourceId}`;
  if (s.kind === 'crop') return `crop:${s.componentId}`;
  if (s.kind === 'sheet') return `sheet:${s.componentId}`;
  return `view:${s.componentId}:${s.viewId}`;
}

export function listAssetSetCompanionHydrateTasks(assets: WorkflowAsset[]): AssetSetCompanionHydrateTask[] {
  const tasks: AssetSetCompanionHydrateTask[] = [];
  for (const asset of assets) {
    if (!isWorkflowAssetSetAsset(asset)) continue;
    const doc = asset.assetSet;
    if (!doc) continue;
    for (const source of doc.sourceAssets ?? []) {
      const companionKey = String(source.imageCompanionKey || '').trim();
      if (!companionKey) continue;
      tasks.push({
        assetId: asset.id,
        slot: { kind: 'source', sourceId: source.id },
        companionKey,
        prevImg: String(source.image || '').trim(),
      });
    }
    for (const component of doc.components ?? []) {
      const cropKey = String(component.cropPreviewCompanionKey || '').trim();
      if (cropKey) {
        tasks.push({
          assetId: asset.id,
          slot: { kind: 'crop', componentId: component.id },
          companionKey: cropKey,
          prevImg: String(component.cropPreview || '').trim(),
        });
      }
      const sheetKey = String(component.multiviewSheetCompanionKey || '').trim();
      if (sheetKey) {
        tasks.push({
          assetId: asset.id,
          slot: { kind: 'sheet', componentId: component.id },
          companionKey: sheetKey,
          prevImg: String(component.multiviewSheet || '').trim(),
        });
      }
      for (const view of component.views ?? []) {
        const viewKey = String(view.imageCompanionKey || '').trim();
        if (!viewKey) continue;
        tasks.push({
          assetId: asset.id,
          slot: { kind: 'view', componentId: component.id, viewId: view.id },
          companionKey: viewKey,
          prevImg: String(view.image || '').trim(),
        });
      }
    }
  }
  return tasks;
}

export function buildAssetSetCompanionHydrateKey(assets: WorkflowAsset[]): string {
  return listAssetSetCompanionHydrateTasks(assets)
    .map(
      (task) =>
        `${task.assetId}:${slotTaskKey(task)}:${task.companionKey}:${storyboardCompanionHydrateSlotSignature(task.prevImg, task.companionKey)}`
    )
    .sort()
    .join('|');
}

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

export async function hydrateAssetSetCompanionTasks(
  tasks: AssetSetCompanionHydrateTask[],
  companionBaseUrl: string,
  companionProjectId: string,
  options?: { concurrency?: number }
): Promise<{
  hydrated: Array<{ task: AssetSetCompanionHydrateTask; objectUrl: string }>;
  failures: Array<{ task: AssetSetCompanionHydrateTask; error: string }>;
}> {
  const base = String(companionBaseUrl || '').trim();
  const pid = String(companionProjectId || '').trim();
  const concurrency = options?.concurrency ?? STORYBOARD_FRAME_COMPANION_HYDRATE_CONCURRENCY;
  const eligible: AssetSetCompanionHydrateTask[] = [];
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

  const hydrated: Array<{ task: AssetSetCompanionHydrateTask; objectUrl: string }> = [];
  const failures: Array<{ task: AssetSetCompanionHydrateTask; error: string }> = [];
  for (const outcome of outcomes) {
    if ('objectUrl' in outcome) {
      hydrated.push({ task: outcome.task, objectUrl: outcome.objectUrl });
    } else {
      failures.push(outcome);
    }
  }
  return { hydrated, failures };
}

export function applyAssetSetCompanionHydrateResults(
  assets: WorkflowAsset[],
  hydrated: Array<{ task: AssetSetCompanionHydrateTask; objectUrl: string }>
): WorkflowAsset[] {
  if (!hydrated.length) return assets;
  const byAsset = new Map<string, Array<{ task: AssetSetCompanionHydrateTask; objectUrl: string }>>();
  for (const item of hydrated) {
    const list = byAsset.get(item.task.assetId) ?? [];
    list.push(item);
    byAsset.set(item.task.assetId, list);
  }
  return assets.map((asset) => {
    const items = byAsset.get(asset.id);
    if (!items?.length || !isWorkflowAssetSetAsset(asset)) return asset;
    let doc = asset.assetSet;
    if (!doc) return asset;
    for (const { task, objectUrl } of items) {
      const slot = task.slot;
      if (slot.kind === 'source') {
        doc = {
          ...doc,
          sourceAssets: doc.sourceAssets.map((source) =>
            source.id === slot.sourceId ? { ...source, image: objectUrl } : source
          ),
        };
        continue;
      }
      doc = {
        ...doc,
        components: doc.components.map((component) => {
          if (component.id !== slot.componentId) return component;
          if (slot.kind === 'crop') {
            return { ...component, cropPreview: objectUrl };
          }
          if (slot.kind === 'sheet') {
            return { ...component, multiviewSheet: objectUrl };
          }
          return {
            ...component,
            views: component.views.map((view) =>
              view.id === slot.viewId ? { ...view, image: objectUrl } : view
            ),
          };
        }),
      };
    }
    return normalizeAssetSetOnAsset({ ...asset, assetSet: doc });
  });
}
