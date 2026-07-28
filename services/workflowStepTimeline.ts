import type { WorkflowAsset } from '../types';

export type WorkflowStepTimelineOrder = 'result_order' | 'newest_first';

/** 与 `WorkflowSection` 版本链 / 滚轮切换一致：按 `resultOrder` 正向（原图 → 最新提交） */
export const DEFAULT_WORKFLOW_STEP_TIMELINE_ORDER: WorkflowStepTimelineOrder = 'result_order';

/** 与侧栏时间线、详情面板共用 */
export function formatWorkflowStepExecutedAt(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return '未记录';
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '未记录';
  }
}

export type WorkflowStepTimelineRow = {
  resultKey: string;
  label: string;
  executedAt: number;
  mediaKind?: string;
  hasImage: boolean;
  hasText: boolean;
  hasModel3d: boolean;
};

/**
 * P0 只读派生：真源为 `resultOrder` + `resultMeta`（标签由调用方 `resolveStepLabel` 收口，可与大图 `getGenerationRecordStepLabel` 对齐）。
 * 不新建平行 `stepTimeline[]`，不与 `pending` 双源。
 */
export function deriveWorkflowStepTimelineRows(
  asset: WorkflowAsset,
  resolveStepLabel: (resultKey: string) => string,
  options?: { order?: WorkflowStepTimelineOrder }
): WorkflowStepTimelineRow[] {
  const rawOrder = asset.resultOrder;
  const order = Array.isArray(rawOrder) && rawOrder.length > 0 ? [...rawOrder] : [];
  const meta = asset.resultMeta || {};
  const results = asset.results || {};
  const textResults = asset.textResults || {};
  const stepModelUrls = asset.stepModelUrls || {};
  const stepModelCompanionKeys = asset.stepModelCompanionKeys || {};

  const rows: WorkflowStepTimelineRow[] = order.map((resultKey) => {
    const m = meta[resultKey];
    const metaLabel = m?.displayStepLabel?.trim();
    const label = metaLabel || resolveStepLabel(resultKey);
    const executedAt = typeof m?.executedAt === 'number' && Number.isFinite(m.executedAt) ? m.executedAt : 0;
    const img = results[resultKey];
    const txt = textResults[resultKey];
    const hasModel3d =
      m?.mediaKind === 'model3d' ||
      (stepModelUrls[resultKey] || []).some((u) => String(u || '').trim() !== '') ||
      (stepModelCompanionKeys[resultKey] || []).some((k) => String(k || '').trim() !== '');
    return {
      resultKey,
      label,
      executedAt,
      mediaKind: m?.mediaKind,
      hasImage: Boolean(img != null && String(img).trim() !== ''),
      hasText: Boolean(txt != null && String(txt).trim() !== ''),
      hasModel3d,
    };
  });

  const orderMode = options?.order ?? DEFAULT_WORKFLOW_STEP_TIMELINE_ORDER;
  if (orderMode === 'newest_first') {
    return rows.slice().reverse();
  }
  return rows;
}
