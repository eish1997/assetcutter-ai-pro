import type { WorkflowAsset } from '../types';

export type WorkflowStepTimelineOrder = 'result_order' | 'newest_first';

/** 与 `WorkflowSection` 版本链 / 滚轮切换一致：按 `resultOrder` 正向（原图 → 最新提交） */
export const DEFAULT_WORKFLOW_STEP_TIMELINE_ORDER: WorkflowStepTimelineOrder = 'result_order';

export type WorkflowStepTimelineRow = {
  resultKey: string;
  label: string;
  executedAt: number;
  mediaKind?: string;
  hasImage: boolean;
  hasText: boolean;
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

  const rows: WorkflowStepTimelineRow[] = order.map((resultKey) => {
    const m = meta[resultKey];
    const metaLabel = m?.displayStepLabel?.trim();
    const label = metaLabel || resolveStepLabel(resultKey);
    const executedAt = typeof m?.executedAt === 'number' && Number.isFinite(m.executedAt) ? m.executedAt : 0;
    const img = results[resultKey];
    const txt = textResults[resultKey];
    return {
      resultKey,
      label,
      executedAt,
      mediaKind: m?.mediaKind,
      hasImage: Boolean(img != null && String(img).trim() !== ''),
      hasText: Boolean(txt != null && String(txt).trim() !== ''),
    };
  });

  const orderMode = options?.order ?? DEFAULT_WORKFLOW_STEP_TIMELINE_ORDER;
  if (orderMode === 'newest_first') {
    return rows.slice().reverse();
  }
  return rows;
}
