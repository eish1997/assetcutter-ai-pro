import React, { useMemo } from 'react';
import type { WorkflowAsset } from '../types';
import {
  DEFAULT_WORKFLOW_STEP_TIMELINE_ORDER,
  deriveWorkflowStepTimelineRows,
  formatWorkflowStepExecutedAt,
  type WorkflowStepTimelineOrder,
} from '../services/workflowStepTimeline';

export type WorkflowStepTimelinePanelProps = {
  asset: WorkflowAsset;
  resolveStepLabel: (resultKey: string) => string;
  currentDisplayKey: string;
  onSelectDisplayKey?: (key: string) => void;
  /** 默认与 {@link DEFAULT_WORKFLOW_STEP_TIMELINE_ORDER} 一致：`result_order`（与滚轮/缩略图链一致）；可改为 `newest_first` 做审计视角 */
  order?: WorkflowStepTimelineOrder;
  /** inline：侧栏小块；modal：弹层内全宽 */
  density?: 'inline' | 'modal';
};

export const WorkflowStepTimelinePanel: React.FC<WorkflowStepTimelinePanelProps> = (props) => {
  const {
    asset,
    resolveStepLabel,
    currentDisplayKey,
    onSelectDisplayKey,
    order: orderProp,
    density: densityProp,
  } = props;
  const order: WorkflowStepTimelineOrder = orderProp ?? DEFAULT_WORKFLOW_STEP_TIMELINE_ORDER;
  const density: 'inline' | 'modal' = densityProp ?? 'inline';

  const rows = useMemo(
    () => deriveWorkflowStepTimelineRows(asset, resolveStepLabel, { order }),
    [asset, resolveStepLabel, order]
  );

  const pad = density === 'modal' ? 'p-4' : 'px-3 pt-3 pb-2';
  const titleCls = density === 'modal' ? 'text-[10px]' : 'text-[8px]';

  if (rows.length === 0) {
    return (
      <div className={`${pad} border-b border-white/10`}>
        <div className={`${titleCls} font-black text-gray-500 uppercase mb-1.5`}>步骤时间线</div>
        <div className="text-[8px] text-gray-600 leading-relaxed">
          暂无执行步骤（仅原图或未写入 <span className="font-mono">resultOrder</span>）。
        </div>
      </div>
    );
  }

  return (
    <div className={`${pad} border-b border-white/10`}>
      <div className={`${titleCls} font-black text-gray-500 uppercase mb-1.5`}>步骤时间线</div>
      <p className="text-[8px] text-gray-600 mb-2 leading-relaxed">
        由 <span className="font-mono">resultOrder</span> + <span className="font-mono">resultMeta</span> 派生（只读）。
      </p>
      <ul className="space-y-1.5 max-h-[min(40vh,16rem)] overflow-y-auto pr-1 [scrollbar-width:thin]">
        {rows.map((row) => {
          const selected = row.resultKey === currentDisplayKey;
          const timeLine = row.executedAt ? formatWorkflowStepExecutedAt(row.executedAt) : '时间未记录';
          const textXs = density === 'modal' ? 'text-[10px]' : 'text-[8px]';
          const canJump = Boolean(onSelectDisplayKey);
          return (
            <li key={row.resultKey}>
              <button
                type="button"
                disabled={!canJump}
                onClick={() => onSelectDisplayKey?.(row.resultKey)}
                className={[
                  'w-full rounded-lg border px-2 py-1.5 text-left transition-colors',
                  textXs,
                  selected
                    ? 'border-blue-500/45 bg-blue-500/10 text-gray-100'
                    : 'border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/20 hover:bg-white/[0.06]',
                  !canJump ? 'cursor-default opacity-90' : '',
                ].join(' ')}
              >
                <div className="font-semibold text-blue-200/95 leading-snug break-words">{row.label}</div>
                <div className="mt-0.5 font-mono text-[8px] text-gray-500 tabular-nums">{timeLine}</div>
                <div className="mt-0.5 text-[8px] text-gray-500">
                  {[
                    row.hasImage ? '图' : null,
                    row.hasText ? '文' : null,
                    row.hasModel3d ? '3D' : null,
                    row.mediaKind && !row.hasModel3d ? row.mediaKind : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1 text-[7px] uppercase tracking-wide text-gray-500">
                  {row.hasImage ? (
                    <span className="rounded border border-white/10 px-1 py-0.5 text-gray-400">图</span>
                  ) : null}
                  {row.hasText ? (
                    <span className="rounded border border-white/10 px-1 py-0.5 text-gray-400">文</span>
                  ) : null}
                  {row.hasModel3d ? (
                    <span className="rounded border border-white/10 px-1 py-0.5 text-gray-400">3D</span>
                  ) : null}
                  {row.mediaKind && row.mediaKind !== 'model3d' && row.mediaKind !== 'image' && row.mediaKind !== 'text' ? (
                    <span className="rounded border border-white/10 px-1 py-0.5 text-gray-400">{row.mediaKind}</span>
                  ) : null}
                  <span className="rounded border border-white/10 px-1 py-0.5 font-mono text-gray-500 truncate max-w-[10rem]">
                    {row.resultKey}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
