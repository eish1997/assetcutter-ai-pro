import React from 'react';
import { Check, Circle, Loader2, X, Bot, Wrench } from 'lucide-react';
import type { AgentChildRun, AgentChildRunStatus } from '../../../types/projectAgent';

function StatusIcon({ status }: { status: AgentChildRunStatus }) {
  if (status === 'running') {
    return <Loader2 className="h-3 w-3 animate-spin text-blue-400/90" strokeWidth={2.2} aria-hidden />;
  }
  if (status === 'done') {
    return <Check className="h-3 w-3 text-emerald-400/90" strokeWidth={2.4} aria-hidden />;
  }
  if (status === 'error') {
    return <X className="h-3 w-3 text-red-300/90" strokeWidth={2.4} aria-hidden />;
  }
  if (status === 'cancelled') {
    return <X className="h-3 w-3 text-gray-500" strokeWidth={2.4} aria-hidden />;
  }
  return <Circle className="h-2.5 w-2.5 text-gray-600" strokeWidth={2.2} aria-hidden />;
}

function statusTextClass(status: AgentChildRunStatus): string {
  switch (status) {
    case 'running':
      return 'text-blue-200/95';
    case 'done':
      return 'text-gray-400';
    case 'error':
      return 'text-red-300/90';
    case 'cancelled':
      return 'text-gray-500 line-through';
    default:
      return 'text-gray-500';
  }
}

function KindIcon({ kind }: { kind: AgentChildRun['kind'] }) {
  if (kind === 'expert') {
    return <Bot className="h-3 w-3 text-violet-300/80" strokeWidth={2.2} aria-hidden />;
  }
  return <Wrench className="h-3 w-3 text-gray-500" strokeWidth={2.2} aria-hidden />;
}

export type ChildRunProgressCardsProps = {
  childRuns: AgentChildRun[];
  compact?: boolean;
};

/**
 * U4 / 5A：主助手气泡下的子工人进度卡（agents-as-tools）。
 * 与 AssistantTurnTimeline 并存：时间线=turn 阶段，本组件=子工人视图。
 */
export default function ChildRunProgressCards({
  childRuns,
  compact = false,
}: ChildRunProgressCardsProps) {
  if (!childRuns.length) return null;

  return (
    <div
      className={`flex flex-col gap-1 ${compact ? 'pt-0.5' : 'pt-1'}`}
      data-child-run-cards
    >
      <ul className={`m-0 flex list-none flex-col ${compact ? 'gap-1' : 'gap-1.5'} p-0`}>
        {childRuns.map((run) => (
          <li
            key={run.id}
            className="flex min-w-0 items-center gap-1.5 rounded-md bg-white/[0.04] px-1.5 py-1 ring-1 ring-white/[0.06]"
            data-child-run-status={run.status}
            data-child-run-kind={run.kind}
            title={run.errorMessage || run.label}
          >
            <span className="grid h-3.5 w-3.5 shrink-0 place-items-center">
              <StatusIcon status={run.status} />
            </span>
            <span className="grid h-3.5 w-3.5 shrink-0 place-items-center opacity-80">
              <KindIcon kind={run.kind} />
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-[10px] font-medium leading-snug ${statusTextClass(run.status)}`}
            >
              {run.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
