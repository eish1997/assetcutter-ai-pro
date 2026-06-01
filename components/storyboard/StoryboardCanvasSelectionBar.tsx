import React, { useState } from 'react';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';

type Props = {
  count: number;
  readOnly?: boolean;
  onLock: () => void;
  onUnlock: () => void;
  onApplyFeedback: (text: string) => void;
};

export default function StoryboardCanvasSelectionBar({
  count,
  readOnly = false,
  onLock,
  onUnlock,
  onApplyFeedback,
}: Props) {
  const [feedbackDraft, setFeedbackDraft] = useState('');

  if (count <= 1) return null;

  const applyFeedback = () => {
    const text = feedbackDraft.trim();
    if (!text) return;
    onApplyFeedback(text);
    setFeedbackDraft('');
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-xl bg-white/[0.03] px-2 py-1.5 ring-1 ring-white/[0.06]">
      <span className="shrink-0 text-[10px] font-semibold text-gray-200">已选 {count} 镜</span>
      {readOnly ? null : (
        <>
          <button type="button" onClick={onLock} className={`${STORYBOARD_TOOL_BTN_NEUTRAL} !h-7 !px-2`}>
            通过
          </button>
          <button type="button" onClick={onUnlock} className={`${STORYBOARD_TOOL_BTN_NEUTRAL} !h-7 !px-2`}>
            取消通过
          </button>
          <input
            type="text"
            value={feedbackDraft}
            onChange={(e) => setFeedbackDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyFeedback();
              }
            }}
            placeholder="批量修改反馈"
            className={`${STORYBOARD_FIELD_INPUT} !h-7 min-w-[8rem] flex-1 !py-1 !text-[10px]`}
          />
          <button
            type="button"
            disabled={!feedbackDraft.trim()}
            onClick={applyFeedback}
            className={`${STORYBOARD_TOOL_BTN_PRIMARY} !h-7 !px-2.5 disabled:opacity-40`}
          >
            写入
          </button>
        </>
      )}
    </div>
  );
}
