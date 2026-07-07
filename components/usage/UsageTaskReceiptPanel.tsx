import React from 'react';
import { fetchUsageReceipt, type UsageReceiptLine } from '../../services/usageApi';
import { fmtCredits } from '../../shared/credits';

type UsageTaskReceiptPanelProps = {
  taskId: string;
  expectedTotal?: number | null;
};

function ReceiptLineRow({ line }: { line: UsageReceiptLine }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-[#2e2e32]/40 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-gray-200 leading-snug">{line.label}</p>
        <p className="text-[9px] text-gray-500 mt-0.5">{line.meterSummary}</p>
      </div>
      <p className="text-[10px] text-amber-300/90 tabular-nums shrink-0">
        {line.credits > 0 ? fmtCredits(line.credits) : '0 · BYOK'}
      </p>
    </div>
  );
}

const UsageTaskReceiptPanel: React.FC<UsageTaskReceiptPanelProps> = ({ taskId, expectedTotal }) => {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [lines, setLines] = React.useState<UsageReceiptLine[]>([]);
  const [totalCredits, setTotalCredits] = React.useState(0);

  React.useEffect(() => {
    const tid = String(taskId || '').trim();
    if (!tid) {
      setLoading(false);
      setError('无效任务 ID');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void fetchUsageReceipt(tid)
      .then((res) => {
        if (cancelled) return;
        setLines(Array.isArray(res?.lines) ? res.lines : []);
        setTotalCredits(Math.max(0, Number(res?.totalCredits) || 0));
      })
      .catch((e) => {
        if (cancelled) return;
        setLines([]);
        setTotalCredits(0);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (loading) {
    return <p className="text-[9px] text-gray-500 py-2">加载任务小票…</p>;
  }
  if (error) {
    return <p className="text-[9px] text-rose-400/90 py-2">{error}</p>;
  }
  if (!lines.length) {
    return <p className="text-[9px] text-gray-600 py-2">暂无结算明细（可能为 BYOK 或未回传计量）</p>;
  }

  const mismatch =
    expectedTotal != null &&
    expectedTotal > 0 &&
    totalCredits > 0 &&
    Math.abs(totalCredits - expectedTotal) > 0;

  return (
    <div className="rounded-lg border border-[#2e2e32]/80 bg-[#0a0a0b] px-3 py-2 mt-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wide">任务小票</p>
        <p className="text-[10px] text-amber-400/95 tabular-nums font-medium">
          合计 {fmtCredits(totalCredits)}
        </p>
      </div>
      {lines.map((line, idx) => (
        <ReceiptLineRow key={`${line.billingSku}-${idx}`} line={line} />
      ))}
      {mismatch ? (
        <p className="text-[8px] text-gray-600 mt-1.5">
          分组合计 {fmtCredits(expectedTotal)} 与小票 {fmtCredits(totalCredits)} 因舍入或部分事件未关联可能略有差异。
        </p>
      ) : null}
    </div>
  );
};

export default UsageTaskReceiptPanel;
