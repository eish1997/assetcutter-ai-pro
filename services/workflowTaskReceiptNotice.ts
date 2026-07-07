import { fmtCredits } from '../shared/credits';
import { fetchCreditBalance } from './creditsApi';
import { dispatchCreditsConsumedNotice } from './unifiedAiSoftNotice';
import { fetchUsageReceipt, type UsageReceiptResponse } from './usageApi';

function resolveAvailableBalance(bal: Awaited<ReturnType<typeof fetchCreditBalance>>): number | null {
  const available = Number(bal?.available ?? bal?.balance);
  return Number.isFinite(available) ? available : null;
}

export type WorkflowTaskReceiptLog = (
  level: 'info' | 'warn' | 'error',
  message: string,
  detail?: string
) => void;

/** 任务完成后拉小票并推送扣费通知（优先 receipt，回退 available 差额）。 */
export async function emitWorkflowTaskReceiptNotice(opts: {
  taskId: string;
  taskLabel: string;
  balanceBeforeAvailable?: number | null;
  onLog?: WorkflowTaskReceiptLog;
  receiptDelayMs?: number;
}): Promise<void> {
  const taskId = String(opts.taskId || '').trim();
  if (!taskId) return;

  await new Promise((resolve) => setTimeout(resolve, opts.receiptDelayMs ?? 450));

  let receipt: UsageReceiptResponse | null = null;
  try {
    receipt = await fetchUsageReceipt(taskId);
  } catch {
    receipt = null;
  }

  let credits = Math.max(0, Number(receipt?.totalCredits) || 0);
  if (
    credits <= 0 &&
    opts.balanceBeforeAvailable != null &&
    Number.isFinite(opts.balanceBeforeAvailable)
  ) {
    try {
      const bal = await fetchCreditBalance();
      const after = resolveAvailableBalance(bal);
      if (after != null) {
        credits = Math.max(0, opts.balanceBeforeAvailable - after);
      }
    } catch {
      /* ignore */
    }
  }

  if (credits > 0) {
    dispatchCreditsConsumedNotice(credits, receipt);
  }

  if (receipt?.lines?.length) {
    const detail = receipt.lines
      .map((line) => `${line.label}: ${fmtCredits(line.credits)} · ${line.meterSummary}`)
      .join('\n');
    opts.onLog?.(
      'info',
      `[${opts.taskLabel}] 任务小票 · 合计 ${fmtCredits(receipt.totalCredits)}`,
      detail
    );
  }
}

export { resolveAvailableBalance };
