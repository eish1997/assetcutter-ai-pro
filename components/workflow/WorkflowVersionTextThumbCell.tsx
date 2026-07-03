import React from 'react';
import type { WorkflowVersionTextThumbLines } from '../../services/workflowTextAsset';

type Props = {
  lines: WorkflowVersionTextThumbLines;
  textClassName?: string;
};

export default function WorkflowVersionTextThumbCell({
  lines,
  textClassName = 'text-[6px] leading-[1.1] text-gray-300',
}: Props) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center bg-[#141416] p-0.5"
      title={lines.fullText}
    >
      {lines.line1 ? (
        <span className={`block w-full truncate text-center ${textClassName}`}>{lines.line1}</span>
      ) : null}
      {lines.line2 ? (
        <span className={`block w-full truncate text-center ${textClassName}`}>{lines.line2}</span>
      ) : null}
      {lines.showEllipsis ? (
        <span className={`block text-center ${textClassName} text-gray-500`}>...</span>
      ) : null}
    </div>
  );
}
