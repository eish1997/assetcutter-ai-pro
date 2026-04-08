import React, { useEffect, useState } from 'react';
import AppIcon from '../ui/AppIcon';
import {
  WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS,
  clampWorkflowTextBody,
} from '../../services/workflowTextAsset';

type Props = {
  open: boolean;
  title: string;
  body: string;
  displayKey?: string;
  versions?: Array<{ key: string; label: string }>;
  onSelectDisplayKey?: (key: string) => void;
  onDiscardDisplayKey?: (key: string) => void;
  onClose: () => void;
  onSave: (next: { textTitle: string; textBody: string }) => void;
  /** 与工作区大图一致：滚轮切上一张/下一张根资产 */
  wheelListLength: number;
  onWheelNavigate: (deltaSteps: number) => void;
};

const WorkflowTextAssetOverlay: React.FC<Props> = ({
  open,
  title,
  body,
  displayKey = 'original',
  versions = [{ key: 'original', label: '原始' }],
  onSelectDisplayKey,
  onDiscardDisplayKey,
  onClose,
  onSave,
  wheelListLength,
  onWheelNavigate,
}) => {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftBody, setDraftBody] = useState(body);

  useEffect(() => {
    if (!open) return;
    setDraftTitle(title);
    setDraftBody(body);
  }, [open, title, body]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex flex-col bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="文字资产"
      onWheel={(e) => {
        if (wheelListLength <= 1) return;
        e.preventDefault();
        e.stopPropagation();
        onWheelNavigate(e.deltaY > 0 ? 1 : -1);
      }}
    >
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-[#0c0c0e]">
        <span className="text-[10px] font-black uppercase tracking-widest text-blue-300">文字资产</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onSave({
                textTitle: draftTitle.trim(),
                textBody: clampWorkflowTextBody(draftBody),
              });
              onClose();
            }}
            className="px-4 py-2 rounded-xl bg-blue-600 border border-blue-500 text-[10px] font-black uppercase text-white hover:bg-blue-500"
          >
            保存并关闭
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full text-white/60 hover:text-white bg-white/5 hover:bg-white/10"
            aria-label="关闭"
          >
            <AppIcon name="close" className="w-4 h-4" />
          </button>
        </div>
      </div>
      {versions.length > 1 && (
        <div className="shrink-0 px-4 py-2 border-b border-white/10 bg-[#111114]">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[8px] font-black text-gray-500 uppercase mr-1">版本</span>
            {versions.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => onSelectDisplayKey?.(v.key)}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${
                  displayKey === v.key
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-[#26262c] border-[#3a3a40] hover:bg-[#383842]'
                }`}
              >
                {v.label}
              </button>
            ))}
            {displayKey !== 'original' && onDiscardDisplayKey && (
              <button
                type="button"
                onClick={() => onDiscardDisplayKey(displayKey)}
                className="ml-auto px-2 py-1 rounded text-[8px] font-black text-red-300 border border-red-900/60 bg-red-950/25 hover:bg-red-900/30"
              >
                丢弃当前版本
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col p-4 sm:p-6 max-w-3xl w-full mx-auto">
        <label className="block text-[9px] font-black uppercase text-gray-500 mb-1.5">标题（可选）</label>
        <input
          type="text"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          maxLength={200}
          className="w-full mb-4 bg-[#141416] border border-[#2e2e32] rounded-xl px-3 py-2.5 text-[12px] text-gray-100 outline-none focus:border-blue-500"
          placeholder="例如：提示词备忘"
        />
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[9px] font-black uppercase text-gray-500">正文</label>
          <span className="text-[8px] text-gray-600">
            {draftBody.length} / {WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS}
          </span>
        </div>
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(clampWorkflowTextBody(e.target.value))}
          className="flex-1 min-h-[12rem] w-full resize-none bg-[#141416] border border-[#2e2e32] rounded-xl px-3 py-2.5 text-[12px] text-gray-100 outline-none focus:border-blue-500 font-mono leading-relaxed"
          placeholder="在此输入文字内容…"
          spellCheck={false}
        />
        {wheelListLength > 1 && (
          <p className="mt-3 text-[8px] text-gray-600 text-center">滚轮切换其他工作区资产</p>
        )}
      </div>
    </div>
  );
};

export default WorkflowTextAssetOverlay;
