import React from 'react';
import type { ProjectAgentPerceptionContext } from '../../../types/runtimePerception';

export type QuickComposePerceptionBarProps = {
  perception?: ProjectAgentPerceptionContext | null;
};

function chipClass(active: boolean, warn = false): string {
  if (warn) return 'border-amber-300/20 bg-amber-300/[0.08] text-amber-100/85';
  if (active) return 'border-cyan-300/15 bg-cyan-300/[0.07] text-cyan-100/85';
  return 'border-white/[0.08] bg-white/[0.035] text-gray-500';
}

function Chip({ text, active, warn = false }: { text?: string; active: boolean; warn?: boolean }) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  return (
    <span
      className={`inline-flex min-w-0 max-w-full shrink-0 items-center rounded-md border px-2 py-1 text-[10px] font-semibold leading-none ${chipClass(active, warn)}`}
      title={clean}
    >
      <span className="truncate">{clean}</span>
    </span>
  );
}

export default function QuickComposePerceptionBar({ perception }: QuickComposePerceptionBarProps) {
  if (!perception) return null;
  return (
    <div
      className="shrink-0 border-b border-white/[0.06] bg-white/[0.018] px-3 py-1.5"
      data-agent-perception-bar
      title={perception.visibleSummary}
    >
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <Chip text={perception.targetSummary} active />
        <Chip text={perception.workflowSummary} active={Boolean(perception.workflowSummary)} />
        <Chip text={perception.externalSummary} active={Boolean(perception.externalSummary)} />
        <Chip text={perception.riskSummary} active={false} warn={Boolean(perception.riskSummary)} />
        <Chip text={perception.stale ? 'Context may be stale' : ''} active={false} warn />
      </div>
    </div>
  );
}
