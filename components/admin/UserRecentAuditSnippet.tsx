import React from 'react';
import { fetchAuditLogs } from '../../services/adminClient';
import { auditActionLabel } from '../../services/adminMatrix';
import { auditLogSummary } from '../../services/auditLogSummary';
import { adminAuditUrlForUser, navigateAdmin } from '../../services/adminNavigate';

type Props = {
  userId: string;
  username?: string;
};

const UserRecentAuditSnippet: React.FC<Props> = ({ userId, username }) => {
  const [logs, setLogs] = React.useState<
    Array<{ id: string; action: string; actorIdentifier: string; createdAt: string; meta: unknown; targetUserId: string | null }>
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void fetchAuditLogs({ targetUserId: userId, limit: 5, offset: 0 })
      .then((res) => {
        if (cancelled) return;
        setLogs(res.logs as typeof logs);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div className="px-3 py-3 bg-[#0f0f12] border-t border-[#252528]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[10px] text-gray-400">
          最近审计 · {username || userId.slice(0, 8)}
        </p>
        <button
          type="button"
          className="text-[10px] text-blue-300 hover:underline"
          onClick={() => navigateAdmin(adminAuditUrlForUser(userId))}
        >
          全部审计
        </button>
      </div>
      {loading ? <p className="text-[10px] text-gray-600">加载中…</p> : null}
      {error ? <p className="text-[10px] text-red-400">{error}</p> : null}
      {!loading && !error ? (
        <ul className="space-y-1.5">
          {logs.map((item) => (
            <li key={item.id} className="text-[10px] text-gray-400 leading-relaxed">
              <span className="text-gray-600">{new Date(item.createdAt).toLocaleString()} · </span>
              <span className="text-gray-500">{auditActionLabel(item.action)} · </span>
              {auditLogSummary({
                action: item.action,
                actorIdentifier: item.actorIdentifier,
                targetUserId: item.targetUserId,
                meta: item.meta,
              })}
            </li>
          ))}
          {!logs.length ? <li className="text-[10px] text-gray-600">暂无相关审计记录</li> : null}
        </ul>
      ) : null}
    </div>
  );
};

export default UserRecentAuditSnippet;
