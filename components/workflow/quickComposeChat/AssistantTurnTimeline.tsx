import React from 'react';
import { Check, Circle, Loader2, X } from 'lucide-react';
import type { AssistantTimelineModel, AssistantTimelineStepState } from '../../../services/projectAgent/assistantTimeline';

function StepIcon({ state }: { state: AssistantTimelineStepState }) {
  if (state === 'active') {
    return <Loader2 className="h-3 w-3 animate-spin text-blue-400/90" strokeWidth={2.2} aria-hidden />;
  }
  if (state === 'done') {
    return <Check className="h-3 w-3 text-emerald-400/90" strokeWidth={2.4} aria-hidden />;
  }
  if (state === 'error') {
    return <X className="h-3 w-3 text-red-300/90" strokeWidth={2.4} aria-hidden />;
  }
  // pending | skipped
  return (
    <Circle
      className={`h-2.5 w-2.5 ${state === 'skipped' ? 'text-gray-700' : 'text-gray-600'}`}
      strokeWidth={2.2}
      aria-hidden
    />
  );
}

function stepTextClass(state: AssistantTimelineStepState): string {
  switch (state) {
    case 'active':
      return 'text-blue-200/95';
    case 'done':
      return 'text-gray-400';
    case 'error':
      return 'text-red-300/90';
    case 'skipped':
      return 'text-gray-700 line-through';
    default:
      return 'text-gray-600';
  }
}

export type AssistantTurnTimelineProps = {
  model: AssistantTimelineModel;
  compact?: boolean;
  onCancel?: () => void;
};

/** P0.5-d：计划→排队→工具→完成 的细步骤条（派生自消息，非第二套状态机）。 */
export default function AssistantTurnTimeline({
  model,
  compact = false,
  onCancel,
}: AssistantTurnTimelineProps) {
  return (
    <div
      className={`flex flex-col gap-1 ${compact ? 'pt-0.5' : 'pt-1'}`}
      data-assistant-timeline
      data-timeline-inflight={model.inFlight ? '1' : '0'}
    >
      <ol className={`m-0 flex list-none flex-col ${compact ? 'gap-0.5' : 'gap-1'} p-0`}>
        {model.steps.map((step) => (
          <li key={step.id} className="flex min-w-0 items-center gap-1.5">
            <span className="grid h-3.5 w-3.5 shrink-0 place-items-center">
              <StepIcon state={step.state} />
            </span>
            <span
              className={`min-w-0 truncate text-[10px] font-medium leading-snug ${stepTextClass(step.state)}`}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      {model.inFlight && onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-gray-300 ring-1 ring-white/[0.1] outline-none transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/45"
        >
          <X className="h-3 w-3" strokeWidth={2.2} aria-hidden />
          取消
        </button>
      ) : null}
    </div>
  );
}
