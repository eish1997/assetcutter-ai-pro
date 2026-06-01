import React from 'react';
import type { StoryboardTableRow } from '../../types';
import {
  storyboardRowEditFeedbackPreview,
  storyboardRowHasEditFeedback,
} from './storyboardRowDisplay';

type Props = {
  row: StoryboardTableRow;
  className?: string;
  /** compact：仅圆点；badge：文字徽章 */
  variant?: 'dot' | 'badge';
  label?: string;
};

export default function StoryboardEditFeedbackMark({
  row,
  className = '',
  variant = 'badge',
  label = '反馈',
}: Props) {
  if (!storyboardRowHasEditFeedback(row)) return null;
  const preview = storyboardRowEditFeedbackPreview(row, 120) ?? '已填写修改反馈';

  if (variant === 'dot') {
    return (
      <span
        title={preview}
        aria-label="已填写修改反馈"
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.55)] ${className}`}
      />
    );
  }

  return (
    <span
      title={preview}
      className={`inline-flex shrink-0 items-center rounded px-1 py-px text-[8px] font-semibold text-sky-200/95 ring-1 ring-sky-400/35 bg-sky-500/15 ${className}`}
    >
      {label}
    </span>
  );
}
