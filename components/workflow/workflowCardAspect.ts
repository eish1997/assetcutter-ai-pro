import type { WorkflowAsset } from '../../types';
import { readSessionJson, writeSessionJson } from '../../services/clientPersist';
import { isWorkflowStoryboardTableAsset } from '../../services/storyboardTableAsset';
import { isWorkflowTextAsset } from '../../services/workflowTextAsset';

/** 历史全局键；新逻辑按项目 id 分桶，避免多项目互相污染导致进项目时比例错乱 */
const WORKFLOW_CARD_ASPECT_SESSION_KEY_LEGACY = 'ac:workflowCardAspect';

function workflowCardAspectSessionKey(projectId: string | null | undefined): string {
  const p = String(projectId || '').trim();
  return p ? `ac:workflowCardAspect:${p}` : WORKFLOW_CARD_ASPECT_SESSION_KEY_LEGACY;
}

export function readSessionWorkflowCardAspects(projectId?: string | null): Record<string, number> {
  return readSessionJson(workflowCardAspectSessionKey(projectId), {}, (parsed) => {
    if (!parsed || typeof parsed !== 'object') return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  });
}

export function persistWorkflowCardAspects(
  projectId: string | null | undefined,
  record: Record<string, number>
): void {
  writeSessionJson(workflowCardAspectSessionKey(projectId), record);
}

export function clampWorkflowCardAspectRatio(w: number, h: number): number {
  if (!(w > 0) || !(h > 0)) return 1;
  return Math.max(0.5, Math.min(2, w / h));
}

/** 约定宽高比夹在 [1:2, 2:1]；允许用 1 修正 session/占位错误写入的默认方图 */
export function mergeCardAspectFromIntrinsic(
  prev: Record<string, number>,
  key: string,
  w: number,
  h: number
): Record<string, number> | null {
  if (!(w > 0) || !(h > 0)) return null;
  const ratio = clampWorkflowCardAspectRatio(w, h);
  const cur = prev[key];
  if (cur != null && cur !== 1) return null;
  if (cur === 1 && Math.abs(ratio - 1) < 0.08) return null;
  if (cur === ratio) return null;
  return { ...prev, [key]: ratio };
}

/** 与 `mergeCardAspectFromIntrinsic` 同一套「是否用新比例覆盖」规则，用于写入 `WorkflowAsset.gridCardAspectRatio` */
export function nextGridCardAspectRatioFromIntrinsic(
  prevStored: number | undefined,
  w: number,
  h: number
): number | null {
  if (!(w > 0) || !(h > 0)) return null;
  const ratio = clampWorkflowCardAspectRatio(w, h);
  const cur = prevStored;
  if (cur != null && cur !== 1) return null;
  if (cur === 1 && Math.abs(ratio - 1) < 0.08) return null;
  if (cur === ratio) return null;
  return ratio;
}

/**
 * 解析网格卡片占位宽高比：优先资产上持久化字段，其次 session 映射（含组内槽位等合成 key）。
 */
export function resolveWorkflowGridCardAspect(
  asset: WorkflowAsset | null | undefined,
  aspectMap: Record<string, number>,
  syntheticKey: string | undefined,
  fallback: number
): number {
  if (asset) {
    const p = asset.gridCardAspectRatio;
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
      return Math.max(0.5, Math.min(2, p));
    }
    const m = aspectMap[asset.id];
    if (typeof m === 'number' && Number.isFinite(m) && m > 0) return m;
  }
  if (syntheticKey) {
    const m = aspectMap[syntheticKey];
    if (typeof m === 'number' && Number.isFinite(m) && m > 0) return m;
  }
  return fallback;
}

/** 工作区画布卡片占位宽高比（分镜表 / 文本 / 图片 / 合成 key） */
export function resolveWorkflowCanvasCardAspect(
  asset: WorkflowAsset | null | undefined,
  aspectMap: Record<string, number>,
  opts: {
    hasDisplayImage?: boolean;
    hasTextPayload?: boolean;
    syntheticKey?: string;
    fallback?: number;
  } = {}
): number {
  const fallback = opts.fallback ?? 1;
  if (asset && isWorkflowStoryboardTableAsset(asset)) return 4 / 3;
  if (opts.hasDisplayImage) {
    return resolveWorkflowGridCardAspect(asset, aspectMap, opts.syntheticKey, fallback);
  }
  if (asset && isWorkflowTextAsset(asset) && opts.hasTextPayload) return 3 / 4;
  return resolveWorkflowGridCardAspect(asset, aspectMap, opts.syntheticKey, fallback);
}
