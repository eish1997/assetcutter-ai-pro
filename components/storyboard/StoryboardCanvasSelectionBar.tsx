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
  onRemove: () => void;
};

export default function StoryboardCanvasSelectionBar({
  count,
  readOnly = false,
  onLock,
  onUnlock,
  onApplyFeedback,
  onRemove,
}: Props) {
  const [feedbackDraft, setFeedbackDraft] = useState('');

  const applyFeedback = () => {
    const text = feedbackDraft.trim();
    if (!text) return;
    onApplyFeedback(text);
    setFeedbackDraft('');
  };

  const hasSelection = count > 0;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span
        className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ${
          hasSelection
            ? 'bg-teal-500/10 text-teal-200/95 ring-teal-400/25'
            : 'bg-white/[0.03] text-gray-500 ring-white/[0.06]'
        }`}
      >
        已选 {count}
      </span>
      {readOnly ? null : (
        <>
          <button
            type="button"
            disabled={!hasSelection}
            onClick={onRemove}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} !h-7 !px-2 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40`}
          >
            删除
          </button>
          <button
            type="button"
            disabled={!hasSelection}
            onClick={onLock}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} !h-7 !px-2 disabled:opacity-40`}
          >
            通过
          </button>
          <button
            type="button"
            disabled={!hasSelection}
            onClick={onUnlock}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} !h-7 !px-2 disabled:opacity-40`}
          >
            取消通过
          </button>
          <input
            type="text"
            value={feedbackDraft}
            disabled={!hasSelection}
            onChange={(e) => setFeedbackDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyFeedback();
              }
            }}
            placeholder="批量修改反馈"
            className={`${STORYBOARD_FIELD_INPUT} !h-7 min-w-[7.5rem] flex-1 !py-1 !text-[10px] disabled:opacity-40 sm:min-w-[9rem]`}
          />
          <button
            type="button"
            disabled={!hasSelection || !feedbackDraft.trim()}
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
