import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS,
  clampWorkflowTextBody,
} from '../../services/workflowTextAsset';

export type WorkflowTextLightboxCenterHandle = {
  save: () => void;
  saveAndClose: () => void;
  setEditingMode: (editing: boolean) => void;
};

type Props = {
  /** 打开或切换版本时刷新草稿 */
  resetKey: string;
  title: string;
  body: string;
  onPersist: (next: { textTitle: string; textBody: string }) => void;
  onSaveAndClose: () => void;
};

/**
 * 工作区大图预览「中央区」专用：仅含原文字资产弹层中的标题 + 正文编辑卡片（无外框壳）。
 */
const WorkflowTextLightboxCenter = forwardRef<WorkflowTextLightboxCenterHandle, Props>(
  function WorkflowTextLightboxCenter(
    { resetKey, title, body, onPersist, onSaveAndClose },
    ref
  ) {
    const [draftTitle, setDraftTitle] = useState(title);
    const [draftBody, setDraftBody] = useState(body);
    const [editing, setEditing] = useState(true);
    const onPersistRef = useRef(onPersist);
    const onSaveAndCloseRef = useRef(onSaveAndClose);
    onPersistRef.current = onPersist;
    onSaveAndCloseRef.current = onSaveAndClose;

    useEffect(() => {
      setDraftTitle(title);
      setDraftBody(body);
      setEditing(true);
    }, [resetKey, title, body]);

    const flush = () => {
      onPersistRef.current({
        textTitle: draftTitle.trim(),
        textBody: clampWorkflowTextBody(draftBody),
      });
    };

    useImperativeHandle(
      ref,
      () => ({
        save: () => {
          flush();
          setEditing(false);
        },
        saveAndClose: () => {
          flush();
          onSaveAndCloseRef.current();
        },
        setEditingMode: (next) => setEditing(next),
      }),
      [draftTitle, draftBody]
    );

    return (
      <div
        className="w-full max-w-full min-w-0 h-[min(82vh,56rem)] rounded-2xl border border-white/10 bg-[#0f0f12]/98 shadow-xl backdrop-blur-[2px] p-4 sm:p-5 flex flex-col min-h-0 pointer-events-auto"
        onMouseDownCapture={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        <div className="mb-3">
          <div className="text-[8px] font-black text-gray-500 uppercase mb-1">标题</div>
          {editing ? (
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              maxLength={200}
              className="w-full bg-[#141416] border border-[#2e2e32] rounded-xl px-3 py-2.5 text-[12px] text-gray-100 outline-none focus:border-blue-500"
              placeholder="例如：提示词备忘"
            />
          ) : (
            <div className="rounded-xl border border-[#2e2e32] bg-[#141416]/95 px-3 py-2.5 text-[12px] text-gray-100 min-h-[2.3rem]">
              {draftTitle.trim() || <span className="text-gray-500">（无标题）</span>}
            </div>
          )}
        </div>
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[8px] font-black text-gray-500 uppercase">正文</div>
          <div className="text-[8px] text-gray-600">
            {draftBody.length} / {WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS}
          </div>
        </div>
        {editing ? (
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(clampWorkflowTextBody(e.target.value))}
            className="flex-1 min-h-[12rem] w-full resize-none bg-[#141416]/95 border border-[#2e2e32] rounded-xl px-3 py-2.5 text-[12px] text-gray-100 outline-none focus:border-blue-500 font-mono leading-relaxed"
            placeholder="在此输入文字内容…"
            spellCheck={false}
            data-image-preview-scroll
          />
        ) : (
          <div
            className="flex-1 min-h-[12rem] overflow-y-auto rounded-xl border border-[#2e2e32] bg-[#141416]/95 px-3 py-2.5 text-[12px] text-gray-100 whitespace-pre-wrap break-words leading-relaxed font-mono"
            data-image-preview-scroll
          >
            {draftBody.trim() || <span className="text-gray-500">（暂无正文）</span>}
          </div>
        )}
      </div>
    );
  }
);

export default WorkflowTextLightboxCenter;
