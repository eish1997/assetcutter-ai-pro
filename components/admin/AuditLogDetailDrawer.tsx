import React from 'react';
import { createPortal } from 'react-dom';
import { auditActionLabel } from '../../services/adminMatrix';
import { auditActionSeverity, AUDIT_SEVERITY_DOT } from '../../services/auditActionSeverity';
import { auditLogSummary } from '../../services/auditLogSummary';
import AuditMetaDiff from './AuditMetaDiff';

export type AuditLogDetail = {
  id: string;
  actorIdentifier: string;
  action: string;
  targetUserId: string | null;
  meta: unknown;
  ip: string;
  userAgent?: string;
  createdAt: string;
};

type Props = {
  log: AuditLogDetail | null;
  onClose: () => void;
  onFilterTarget?: (userId: string) => void;
};

const AuditLogDetailDrawer: React.FC<Props> = ({ log, onClose, onFilterTarget }) => {
  const [showRaw, setShowRaw] = React.useState(false);

  React.useEffect(() => {
    if (!log) return;
    setShowRaw(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [log, onClose]);

  if (!log) return null;

  const severity = auditActionSeverity(log.action);
  const summary = auditLogSummary({
    action: log.action,
    actorIdentifier: log.actorIdentifier,
    targetUserId: log.targetUserId,
    meta: log.meta,
  });

  return createPortal(
    <>
      <button
        type="button"
        aria-label="关闭"
        className="fixed inset-0 z-[2100] bg-black/55"
        onClick={onClose}
      />
      <aside className="fixed top-0 right-0 z-[2101] h-full w-full max-w-md border-l border-[#2e2e32] bg-[#121214] shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-4 py-4 border-b border-[#2e2e32]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${AUDIT_SEVERITY_DOT[severity]}`} />
              <h3 className="text-[12px] font-semibold text-white truncate">{auditActionLabel(log.action)}</h3>
            </div>
            <p className="mt-2 text-[11px] text-gray-300 leading-relaxed">{summary}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 px-2 py-1 rounded-lg border border-[#2e2e32] text-[10px] text-gray-400 hover:bg-[#2e2e36]"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-[11px]">
          <dl className="space-y-2">
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 shrink-0">时间</dt>
              <dd className="text-gray-300 text-right">{new Date(log.createdAt).toLocaleString()}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 shrink-0">操作者</dt>
              <dd className="text-gray-300 text-right">{log.actorIdentifier || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 shrink-0">IP</dt>
              <dd className="text-gray-300 text-right font-mono">{log.ip || '—'}</dd>
            </div>
            {log.userAgent ? (
              <div>
                <dt className="text-gray-500 mb-1">User-Agent</dt>
                <dd className="text-gray-400 text-[10px] break-all leading-relaxed">{log.userAgent}</dd>
              </div>
            ) : null}
            {log.targetUserId ? (
              <div className="flex justify-between gap-4 items-start">
                <dt className="text-gray-500 shrink-0">目标用户</dt>
                <dd className="text-right">
                  <button
                    type="button"
                    className="text-blue-300 hover:underline font-mono text-[10px] break-all"
                    onClick={() => onFilterTarget?.(log.targetUserId!)}
                  >
                    {log.targetUserId}
                  </button>
                </dd>
              </div>
            ) : null}
          </dl>
          {log.meta != null ? (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">变更详情</p>
              <AuditMetaDiff action={log.action} meta={log.meta} />
            </div>
          ) : null}
          {log.meta != null ? (
            <div>
              <button
                type="button"
                className="text-[10px] text-gray-500 hover:text-gray-300"
                onClick={() => setShowRaw((v) => !v)}
              >
                {showRaw ? '收起原始 JSON' : '展开原始 JSON'}
              </button>
              {showRaw ? (
                <pre className="mt-2 text-[10px] text-gray-500 whitespace-pre-wrap break-all bg-[#0a0a0c] rounded-xl p-3 border border-[#252528]">
                  {JSON.stringify(log.meta, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </>,
    document.body
  );
};

export default AuditLogDetailDrawer;
