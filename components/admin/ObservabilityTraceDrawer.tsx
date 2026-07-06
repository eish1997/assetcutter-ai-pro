import React from 'react';
import {
  fetchObservabilityTrace,
  type ObservabilityTraceResponse,
  type TaskExecutionEvent,
} from '../../services/adminClient';
import {
  taskEventCodeLabel,
  taskEventLevelDot,
  taskEventSummary,
} from '../../services/taskEventSummary';
import { fmtUsageEventCredits, sumUsageEventsCredits } from '../../services/usageApi';
import { fmtCredits } from '../../shared/credits';

type ObservabilityTraceDrawerProps = {
  correlationId: string | null;
  onClose: () => void;
};

const ObservabilityTraceDrawer: React.FC<ObservabilityTraceDrawerProps> = ({ correlationId, onClose }) => {
  const [trace, setTrace] = React.useState<ObservabilityTraceResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    const id = String(correlationId || '').trim();
    if (!id) {
      setTrace(null);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void fetchObservabilityTrace(id)
      .then((res) => {
        if (!cancelled) setTrace(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [correlationId]);

  if (!correlationId) return null;

  const taskEvents = trace?.taskEvents.events ?? [];
  const usageEvents = trace?.usage.events ?? [];

  return (
    <div className="fixed inset-0 z-[130] flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="关闭" />
      <aside className="relative w-full max-w-lg h-full bg-[#121214] border-l border-[#2e2e32] overflow-y-auto p-4 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">可观测 Trace</p>
            <p className="mt-1 text-[11px] text-gray-300 font-mono break-all">{correlationId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 rounded border border-[#2e2e32] text-[10px] text-gray-400"
          >
            关闭
          </button>
        </div>

        {loading ? <p className="text-[11px] text-gray-500">加载中…</p> : null}
        {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

        {trace && !loading ? (
          <>
            <section className="rounded-xl border border-[#2e2e32] bg-[#0f0f0f] p-3 space-y-2">
              <h3 className="text-[10px] font-black uppercase text-blue-400/80">用量环</h3>
              <p className="text-[11px] text-gray-300">
                {trace.usage.eventCount} 条 · 消耗{' '}
                <span className="text-amber-400/90">
                  {fmtCredits(sumUsageEventsCredits(usageEvents))}
                </span>{' '}
                积分
              </p>
              {usageEvents.length === 0 ? (
                <p className="text-[10px] text-gray-500">无关联用量记录</p>
              ) : (
                <ul className="space-y-1.5 max-h-[28vh] overflow-y-auto">
                  {usageEvents.map((ev) => (
                    <li
                      key={ev.id}
                      className="rounded-lg border border-[#2e2e32]/60 px-2 py-1.5 text-[10px] text-gray-300"
                    >
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-400">{new Date(ev.createdAt).toLocaleString()}</span>
                        <span className="text-amber-400/80">{fmtUsageEventCredits(ev)}</span>
                      </div>
                      <p>{ev.billingSku}</p>
                      {ev.auditLogId ? (
                        <p className="text-[9px] text-gray-500 font-mono mt-0.5">audit {ev.auditLogId}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-[#2e2e32] bg-[#0f0f0f] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[10px] font-black uppercase text-emerald-400/80">任务执行环</h3>
                <a
                  href={`/admin/task-events?taskId=${encodeURIComponent(correlationId)}`}
                  className="text-[9px] text-emerald-400/90 hover:text-emerald-300"
                >
                  完整列表 →
                </a>
              </div>
              {taskEvents.length === 0 ? (
                <p className="text-[10px] text-gray-500">无关联执行记录</p>
              ) : (
                <ul className="space-y-1.5 max-h-[36vh] overflow-y-auto">
                  {taskEvents.map((ev: TaskExecutionEvent) => (
                    <li
                      key={ev.id}
                      className="rounded-lg border border-[#2e2e32]/60 px-2 py-1.5 text-[10px]"
                    >
                      <div className="flex items-center justify-between gap-2 text-gray-400">
                        <span>{new Date(ev.ts).toLocaleString()}</span>
                        <span className="inline-flex items-center gap-1">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${taskEventLevelDot(ev.level)}`} />
                          {taskEventCodeLabel(ev.code)}
                        </span>
                      </div>
                      <p className="text-gray-200 mt-1 leading-relaxed">{taskEventSummary(ev)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </aside>
    </div>
  );
};

export default ObservabilityTraceDrawer;
