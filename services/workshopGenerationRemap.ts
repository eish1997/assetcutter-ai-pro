import type { CustomAppModule, WorkflowAsset, WorkflowPendingTask } from '../types';
import { getCapabilityEngine } from './capabilityEngineKind';
import {
  QUICK_COMPOSE_PLAIN_I2I_ACTION_ID,
  QUICK_COMPOSE_PLAIN_T2I_ACTION_ID,
  QUICK_COMPOSE_PLAIN_VIDEO_ACTION_ID,
} from './quickComposePlainPresets';
import type { WorkshopCanvasItem } from './workshopAssetPackage';
import { workshopFileAssetId } from './workshopFileTree';
import type { WorkshopFileSourceApi } from './workshopFileTree';

export function workshopTitleFromAsset(asset: WorkflowAsset): string {
  const body = String(asset.textBody || '').trim();
  if (body) return body.slice(0, 200);
  const title = String(asset.textTitle || '').trim();
  if (title) return title.slice(0, 200);
  return '生成中';
}

export function isWorkshopBatchEligible(
  newAssets: WorkflowAsset[],
  newTasks: WorkflowPendingTask[],
  modules: CustomAppModule[],
): boolean {
  const imageGenActions = new Set([
    QUICK_COMPOSE_PLAIN_T2I_ACTION_ID,
    QUICK_COMPOSE_PLAIN_I2I_ACTION_ID,
    QUICK_COMPOSE_PLAIN_VIDEO_ACTION_ID,
  ]);
  for (const t of newTasks) {
    if (imageGenActions.has(t.actionType)) return true;
    const mod = modules.find((m) => m.id === t.actionType) ?? null;
    if (!mod) continue;
    const eng = getCapabilityEngine(mod);
    if (
      eng === 'gen_image' ||
      mod.category === 'text_to_image' ||
      mod.category === 'image_to_image' ||
      mod.category === 'generate_video' ||
      mod.category === 'generate_3d'
    ) {
      return true;
    }
  }
  for (const a of newAssets) {
    if (String(a.original || '').trim()) return true;
  }
  return false;
}

export type WorkshopCreatedPackage = {
  assetId: string;
  cardId: string;
  packageRel?: string;
  checkoutRel?: string;
  title: string;
  root: string;
};

export type WorkshopRemapResult = {
  ok: boolean;
  tasks: WorkflowPendingTask[];
  createdPackages: WorkshopCreatedPackage[];
  error?: string;
};

export async function remapGenerationBatchToWorkshop(args: {
  api: WorkshopFileSourceApi;
  root: string;
  parentRel: string;
  newAssets: WorkflowAsset[];
  newTasks: WorkflowPendingTask[];
  titleFromAsset?: (asset: WorkflowAsset) => string;
}): Promise<WorkshopRemapResult> {
  const root = String(args.root || '').trim();
  if (!args.api?.createWorkshopPackage || !root) {
    return { ok: false, tasks: [], createdPackages: [], error: 'no_root_or_api' };
  }
  const titleFn = args.titleFromAsset ?? workshopTitleFromAsset;
  const idMap = new Map<string, string>();
  const createdPackages: WorkshopCreatedPackage[] = [];
  for (const asset of args.newAssets) {
    const original = String(asset.original || '').trim();
    const out = await args.api.createWorkshopPackage({
      root,
      parentRel: args.parentRel || '',
      title: titleFn(asset),
      ...(original.startsWith('data:') || original.startsWith('blob:') || original.startsWith('http')
        ? { originalDataUrl: original }
        : {}),
    });
    if (!out?.ok || !out.assetId) {
      return {
        ok: false,
        tasks: [],
        createdPackages: [],
        error: String(out?.error || 'create_failed'),
      };
    }
    const checkoutRel = String(out.checkoutRel || out.packageRel || '').trim();
    const cardId = checkoutRel
      ? workshopFileAssetId(root, checkoutRel)
      : '';
    if (!cardId) {
      return { ok: false, tasks: [], createdPackages: [], error: 'card_id_failed' };
    }
    idMap.set(asset.id, cardId);
    createdPackages.push({
      assetId: String(out.assetId),
      cardId,
      checkoutRel,
      packageRel: out.packageRel,
      title: titleFn(asset),
      root,
    });
  }
  const tasks = args.newTasks.map((t) => {
    const nextId = idMap.get(t.assetId);
    return nextId ? { ...t, assetId: nextId } : t;
  });
  return { ok: true, tasks, createdPackages };
}

export function optimisticWorkshopPackageItem(args: {
  root: string;
  assetId: string;
  packageRel?: string;
  checkoutRel?: string;
  title: string;
}): WorkshopCanvasItem {
  const checkoutRel = String(args.checkoutRel || '').trim();
  if (checkoutRel) {
    return {
      kind: 'loose',
      root: args.root,
      rel: checkoutRel,
      name: args.title,
      assetKind: 'image',
      size: 0,
      mtimeMs: Date.now(),
      assetId: args.assetId,
      title: args.title,
    };
  }
  const rel = String(args.packageRel || args.assetId).trim();
  return {
    kind: 'package',
    root: args.root,
    rel,
    name: args.title,
    assetKind: 'image',
    size: 0,
    mtimeMs: Date.now(),
    assetId: args.assetId,
    title: args.title,
  };
}

function canvasItemKey(row: WorkshopCanvasItem): string {
  if (row.kind === 'package' && row.assetId) return `${row.root}::pkg::${row.assetId}`;
  return `${row.root}::file::${row.rel}`;
}

export function mergeWorkshopCanvasItems(
  diskItems: WorkshopCanvasItem[],
  optimisticItems: WorkshopCanvasItem[],
): WorkshopCanvasItem[] {
  if (!optimisticItems.length) return diskItems;
  const diskKeys = new Set(diskItems.map((row) => canvasItemKey(row)));
  const pending = optimisticItems.filter((row) => !diskKeys.has(canvasItemKey(row)));
  return [...diskItems, ...pending];
}
