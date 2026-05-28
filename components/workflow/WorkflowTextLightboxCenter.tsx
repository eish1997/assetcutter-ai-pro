import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { clampWorkflowTextBody } from '../../services/workflowTextAsset';
import {
  WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS,
  WORKFLOW_TEXT_CONFIRM_CHARS,
  WORKFLOW_TEXT_WARN_CHARS,
  workflowTextLengthTier,
} from '../../services/workflowTextLimits';

export type WorkflowTextLightboxCenterHandle = {
  flush: () => void;
};

type Props = {
  /** 打开或切换版本时刷新草稿 */
  resetKey: string;
  /** 保留既有标题写入，界面不展示标题编辑 */
  title: string;
  body: string;
  onPersist: (next: { textTitle: string; textBody: string }) => void;
};

/**
 * 工作区大图预览「中央区」：仅正文编辑框，打开即编辑，由父级在关闭时 flush 持久化。
 */
const WorkflowTextLightboxCenter = forwardRef<WorkflowTextLightboxCenterHandle, Props>(
  function WorkflowTextLightboxCenter({ resetKey, title, body, onPersist }, ref) {
    const [draftBody, setDraftBody] = useState(body);
    const titleRef = useRef(title);
    useEffect(() => {
      titleRef.current = title;
    }, [title]);
    const onPersistRef = useRef(onPersist);
    useEffect(() => {
      onPersistRef.current = onPersist;
    }, [onPersist]);

    useEffect(() => {
      setDraftBody(body);
    }, [resetKey, body]);

    const flush = useCallback(() => {
      onPersistRef.current({
        textTitle: titleRef.current.trim(),
        textBody: clampWorkflowTextBody(draftBody),
      });
    }, [draftBody]);

    useImperativeHandle(ref, () => ({ flush }), [flush]);

    const lengthTier = workflowTextLengthTier(draftBody.length);

    return (
      <div
        className="pointer-events-auto flex h-[min(82vh,56rem)] w-full min-h-0 min-w-0 flex-col"
        onMouseDownCapture={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        <div
          className={`mb-2 flex shrink-0 items-center justify-end text-[10px] tabular-nums ${
            lengthTier === 'confirm'
              ? 'text-amber-300'
              : lengthTier === 'warn'
                ? 'text-amber-500/90'
                : 'text-gray-600'
          }`}
        >
          {draftBody.length.toLocaleString()} / {WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS.toLocaleString()}
          {lengthTier === 'warn' ? ' · 较长' : null}
          {lengthTier === 'confirm' ? ' · 入队前将确认' : null}
        </div>
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(clampWorkflowTextBody(e.target.value))}
          className="min-h-0 w-full flex-1 resize-none rounded-xl border border-[#2e2e32] bg-[#141416]/95 px-4 py-3 text-[13px] leading-relaxed text-gray-100 outline-none focus:border-blue-500 font-mono"
          placeholder="在此输入文字内容…"
          spellCheck={false}
          data-image-preview-scroll
        />
      </div>
    );
  }
);

export default WorkflowTextLightboxCenter;
