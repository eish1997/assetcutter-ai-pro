import React from 'react';
import { History } from 'lucide-react';
import type { ImageOverlayAnnotationDoc } from '../../types';
import {
  readWorkflowOverlaySnapshotRing,
  type WorkflowOverlaySnapshotBucket,
  type WorkflowOverlaySnapshotEntry,
} from '../../services/workflowOverlaySnapshots';

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '—';
  }
}

function reasonLabel(e: WorkflowOverlaySnapshotEntry): string {
  return (e.reason ?? 'close') === 'periodic' ? '编辑节流' : '关窗时点';
}

export type WorkflowOverlaySnapshotRecoverPanelProps = {
  assetId: string;
  baseDisplayKey: string;
  onRestore: (bucket: WorkflowOverlaySnapshotBucket, doc: ImageOverlayAnnotationDoc) => void;
};

/**
 * 大图侧栏：列出当前资产 + displayKey 下 **active** 的 overlay 环条目，可恢复到当前大图草稿（单桶）。
 * 数据来自 `readWorkflowOverlaySnapshotRing()`（每次渲染重读 session，与 supersede/append 外部写入对齐）。
 */
export const WorkflowOverlaySnapshotRecoverPanel: React.FC<WorkflowOverlaySnapshotRecoverPanelProps> = ({
  assetId,
  baseDisplayKey,
  onRestore,
}) => {
  const entries = readWorkflowOverlaySnapshotRing()
    .filter(
      (e) =>
        e.assetId === assetId &&
        e.baseDisplayKey === baseDisplayKey &&
        e.status === 'active'
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20);

  return (
    <div className="px-3 pt-2 pb-2 border-b border-white/10">
      <div className="flex items-center gap-1.5 text-[8px] font-black text-gray-500 uppercase mb-1.5">
        <History className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
        标注草稿快照
      </div>
      <p className="text-[8px] text-gray-600 mb-2 leading-relaxed">
        本标签页 session 环中的时点副本；加载会<strong className="text-gray-400">覆盖</strong>当前大图对应桶（平面/全景）上的未写回草稿。
      </p>
      {entries.length === 0 ? (
        <div className="text-[8px] text-gray-600">暂无可用条目（关大图或编辑产生 diff 后会出现）。</div>
      ) : (
        <ul className="space-y-1 max-h-[min(28vh,12rem)] overflow-y-auto pr-1 [scrollbar-width:thin]">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[8px] font-mono text-gray-400 tabular-nums">{formatTs(e.createdAt)}</div>
                <div className="mt-0.5 flex flex-wrap gap-1 text-[7px] uppercase tracking-wide text-gray-500">
                  <span className="rounded border border-white/10 px-1 py-0.5">{e.bucket}</span>
                  <span className="rounded border border-white/10 px-1 py-0.5">{reasonLabel(e)}</span>
                  <span className="rounded border border-white/10 px-1 py-0.5 tabular-nums">{e.docBytes}b</span>
                </div>
              </div>
              <button
                type="button"
                title="将本条快照加载到当前大图对应桶（覆盖未写回草稿）"
                className="shrink-0 rounded-md bg-white/[0.08] px-2 py-1 text-[8px] font-semibold text-blue-200/95 ring-1 ring-white/10 hover:bg-white/[0.12]"
                onClick={() => onRestore(e.bucket, e.doc)}
              >
                加载
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
