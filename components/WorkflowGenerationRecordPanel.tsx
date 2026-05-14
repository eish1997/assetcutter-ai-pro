import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowAsset } from '../types';
import type { ImageVersion, VgpAssetExtension } from '../types/vgp';
import { ensureWorkflowAssetVgp } from '../services/vgp/migrateLegacyAsset';

const PREVIEW_LEN = 120;

export function resolveVersionImageSrc(asset: WorkflowAsset, v: ImageVersion): string {
  if (v.imageRef.kind === 'original_field') return asset.original;
  const key = v.imageRef.key;
  if (key === 'cut_image') {
    return asset.displayKey === 'cut_image' ? asset.original : asset.results[key] ?? asset.original;
  }
  const r = asset.results[key];
  if (r != null && String(r).trim() !== '') return r;
  /** 已删 results 但 VGP 未同步时勿回退原图，避免「丢弃后仍像有图」 */
  return '';
}

function parentStepLabel(
  vgp: VgpAssetExtension,
  parentVersionId: string | null,
  getStepLabel: (stepKey: string) => string
): string {
  if (parentVersionId == null) return '—';
  const pv = vgp.versionsById[parentVersionId];
  if (!pv) return '—';
  if (pv.role === 'original') return '原图';
  return `第 ${pv.stepIndex} 步：${getStepLabel(pv.stepKey)}`;
}

export type WorkflowGenerationRecordPanelProps = {
  asset: WorkflowAsset;
  getStepLabel: (stepKey: string) => string;
  onClose?: () => void;
  mode?: 'modal' | 'inline';
  onSelectDisplayKey?: (key: string) => void;
};

export const WorkflowGenerationRecordPanel: React.FC<WorkflowGenerationRecordPanelProps> = ({
  asset,
  getStepLabel,
  onClose,
  mode = 'modal',
  onSelectDisplayKey,
}) => {
  const [promptExpandedId, setPromptExpandedId] = useState<string | null>(null);
  const displayAsset = useMemo(() => ensureWorkflowAssetVgp(asset), [asset]);
  const vgp = displayAsset.vgp;

  /** 与当前 `displayKey` 对应的 VGP 版本（左侧节点图切换时同步高亮） */
  const selectedVersionId = useMemo(() => {
    if (!vgp) return null;
    const dk = asset.displayKey;
    for (const id of vgp.versionOrder) {
      const v = vgp.versionsById[id];
      if (!v) continue;
      const key = v.imageRef.kind === 'original_field' ? 'original' : v.imageRef.key;
      if (key === dk) return id;
    }
    return null;
  }, [asset.displayKey, vgp]);

  if (!vgp) {
    if (mode === 'inline') {
      /** 步骤时间线由 `WorkflowStepTimelinePanel`（resultOrder 派生）在大图侧栏展示，此处避免重复空态 */
      return null;
    }
    return createPortal(
      <div
        className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/70 p-4"
        onClick={() => onClose?.()}
        role="presentation"
      >
        <div
          className="max-w-lg w-full rounded-2xl border border-white/10 bg-[#141418] p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-gray-300">暂无生成记录数据。</p>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="mt-4 px-4 py-2 rounded-xl bg-white/10 text-[10px] font-black uppercase hover:bg-white/15"
          >
            关闭
          </button>
        </div>
      </div>,
      document.body
    );
  }

  const orderedVersions = vgp.versionOrder.map((id) => vgp.versionsById[id]).filter(Boolean);

  const exportTxt = () => {
    const lines: string[] = [`资产 ${asset.id.slice(0, 8)}… 生成记录`, `导出时间 ${new Date().toLocaleString()}`, ''];
    for (const v of orderedVersions) {
      const sem = vgp.semanticsById[v.semanticStateId];
      const art = v.promptArtifactId ? vgp.promptsById[v.promptArtifactId] : undefined;
      lines.push(`--- 步骤 ${v.stepIndex} (${getStepLabel(v.stepKey)}) ---`);
      lines.push(`上一步：${parentStepLabel(vgp, v.parentVersionId, getStepLabel)}`);
      lines.push(`目标：${sem?.target?.summary ?? '—'}`);
      lines.push(`生成说明：${art?.compiled_prompt ?? '（无）'}`);
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `workflow-gen-record-${asset.id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const panelContent = (
    <div
      className={`${
        mode === 'inline'
          ? 'min-h-0 w-full rounded-none border-0 bg-transparent shadow-none'
          : 'max-w-2xl w-full max-h-[90vh] my-4 overflow-y-auto rounded-2xl border border-white/10 bg-[#0f0f12] shadow-xl'
      }`}
    >
        {mode === 'modal' ? (
          <div className="sticky top-0 z-10 flex items-center justify-end gap-2 px-4 py-3 border-b border-white/10 bg-[#141418]">
            <button
              type="button"
              onClick={() => onClose?.()}
              className="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase bg-blue-600/80 hover:bg-blue-600 text-white"
            >
              关闭
            </button>
          </div>
        ) : null}

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-gray-500">
              已记录步骤数：<span className="text-gray-300 font-mono">{orderedVersions.length}</span>
              {orderedVersions.length <= 1 ? '（仅原图，执行生成步骤后会增加）' : null}
            </p>
            <button
              type="button"
              onClick={exportTxt}
              className="px-2.5 py-1 rounded-lg text-[8px] font-black uppercase border border-white/15 bg-white/5 hover:bg-white/10 text-gray-200 shrink-0"
            >
              导出.TXT
            </button>
          </div>

          {orderedVersions.map((v) => {
            const sem = vgp.semanticsById[v.semanticStateId];
            const art = v.promptArtifactId ? vgp.promptsById[v.promptArtifactId] : undefined;
            const full = art?.compiled_prompt ?? '';
            const short = full.length > PREVIEW_LEN ? `${full.slice(0, PREVIEW_LEN)}…` : full;
            const expanded = promptExpandedId === v.id;
            return (
              <div
                key={v.id}
                id={`vgp-step-${v.id}`}
                className={`rounded-xl border p-3 ${selectedVersionId === v.id ? 'border-blue-500/40 bg-blue-500/5' : 'border-white/10 bg-white/[0.03]'}`}
              >
                <div className="text-[10px] font-black text-blue-300/90">
                  第 {v.stepIndex} 步 · {getStepLabel(v.stepKey)}
                  {v.role === 'cut' ? (
                    <span className="ml-2 text-gray-500 font-normal">（图像处理）</span>
                  ) : null}
                </div>
                <p className="mt-1 text-[10px] text-gray-400">
                  上一步：{parentStepLabel(vgp, v.parentVersionId, getStepLabel)}
                </p>
                <p className="mt-1 text-[10px] text-gray-300">
                  当时目标：{sem?.target?.summary ?? '—'}
                </p>
                <div className="mt-2 text-[10px] text-gray-400">
                  <span className="text-gray-500">生成说明：</span>
                  <span className="text-gray-300 whitespace-pre-wrap">{expanded ? full : short || '（无文本）'}</span>
                </div>
                {full.length > PREVIEW_LEN ? (
                  <button
                    type="button"
                    onClick={() => setPromptExpandedId(expanded ? null : v.id)}
                    className="mt-1 text-[9px] text-blue-400 hover:underline"
                  >
                    {expanded ? '收起' : '展开全文'}
                  </button>
                ) : null}
                {full ? (
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(full)}
                    className="mt-2 px-2 py-1 rounded-lg text-[9px] font-black uppercase border border-white/15 bg-white/5 hover:bg-white/10 text-gray-200"
                  >
                    复制本步完整说明
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
  );

  if (mode === 'inline') return panelContent;

  return createPortal(
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/75 p-4 overflow-y-auto"
      onClick={() => onClose?.()}
      role="presentation"
    >
      <div
        className="max-w-2xl w-full max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {panelContent}
      </div>
    </div>,
    document.body
  );
};
