import React from 'react';
import {
  fmtCreditsEstimateFooter,
  fmtCreditsEstimateFooterWithQuote,
  fmtPlanStepsBreakdown,
  requiresPlatformCredits,
  type AiBillingRouteStep,
} from '../../services/aiBillingGate';
import { useUsageQuoteForSteps } from '../../hooks/useUsageQuoteForSteps';
import { fmtCredits } from '../../shared/credits';

export type TaskCreditsEstimateProps = {
  steps: AiBillingRouteStep[];
  balance?: number | null;
  compact?: boolean;
};

const TaskCreditsEstimate: React.FC<TaskCreditsEstimateProps> = ({ steps, balance, compact = false }) => {
  const { quote } = useUsageQuoteForSteps(steps);

  if (!steps.length) return null;

  const footer = quote
    ? fmtCreditsEstimateFooterWithQuote(steps, balance, quote)
    : fmtCreditsEstimateFooter(steps, balance);
  const lines = footer.lines.length ? footer.lines : fmtPlanStepsBreakdown(steps);
  const showPlatformFooter = requiresPlatformCredits(steps) && footer.totalMin > 0;
  const sufficient =
    balance != null && Number.isFinite(balance) && footer.totalMin > 0 && balance >= footer.totalMin;

  return (
    <div
      className={`rounded-lg border border-white/[0.06] bg-black/30 text-amber-400/80 ${
        compact ? 'px-2 py-1 text-[9px] leading-snug' : 'px-2.5 py-1.5 text-[10px] leading-relaxed'
      }`}
      title="按步骤保守预估，实际扣费以上游用量为准"
    >
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
      {showPlatformFooter ? (
        <div
          className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-white/[0.06] pt-1 ${
            compact ? 'text-[9px]' : 'text-[10px]'
          }`}
        >
          <span className="text-amber-300/95 tabular-nums">合计约 {fmtCredits(footer.totalMin)} 积分起</span>
          {balance != null && Number.isFinite(balance) ? (
            sufficient ? (
              <span className="text-emerald-400/90">✓ 余额充足</span>
            ) : footer.shortfall > 0 ? (
              <span className="text-rose-300/90 tabular-nums">还差 {fmtCredits(footer.shortfall)} 积分</span>
            ) : null
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default TaskCreditsEstimate;
