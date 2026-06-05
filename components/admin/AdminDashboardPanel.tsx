import React from 'react';
import { fetchAdminDashboard, type AdminDashboardPayload } from '../../services/adminDashboardClient';
import { navigateAdmin } from '../../services/adminNavigate';
import { PERMISSIONS } from '../../services/adminPermissions';
import { useAdminStaff } from './AdminStaffContext';

function fmtMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

const StatCard: React.FC<{ label: string; value: string | number; hint?: string; onClick?: () => void }> = ({
  label,
  value,
  hint,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className={`rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 text-left w-full ${
      onClick ? 'hover:bg-[#18181c] cursor-pointer' : 'cursor-default'
    }`}
  >
    <p className="text-[10px] uppercase tracking-[0.15em] text-gray-500">{label}</p>
    <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    {hint ? <p className="mt-1 text-[10px] text-gray-600">{hint}</p> : null}
  </button>
);

const QuickLink: React.FC<{ label: string; path: string }> = ({ label, path }) => (
  <button
    type="button"
    onClick={() => navigateAdmin(path)}
    className="rounded-xl border border-[#2e2e32] bg-[#1c1c22] px-3 py-2 text-[10px] text-gray-200 hover:bg-[#2e2e36]"
  >
    {label}
  </button>
);

const AdminDashboardPanel: React.FC = () => {
  const { can } = useAdminStaff();
  const [data, setData] = React.useState<AdminDashboardPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchAdminDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-6 text-[11px] text-gray-400">加载概览…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">运营概览</h2>
          {data?.generatedAt ? (
            <p className="mt-1 text-[10px] text-gray-600">生成于 {new Date(data.generatedAt).toLocaleString()}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            void load();
          }}
          className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-200 hover:bg-[#2e2e36]"
        >
          刷新
        </button>
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="注册用户" value={data.stats.totalUsers} onClick={() => navigateAdmin('/admin/users')} />
            <StatCard label="近 7 日注册" value={data.stats.registrations7d} />
            <StatCard
              label="近 7 日登录失败"
              value={data.stats.loginFailed7d}
              onClick={can(PERMISSIONS.AUDIT_READ) ? () => navigateAdmin('/admin/audit-logs') : undefined}
            />
            <StatCard
              label="近 7 日后台操作"
              value={data.stats.adminOps7d}
              onClick={can(PERMISSIONS.AUDIT_READ) ? () => navigateAdmin('/admin/audit-logs') : undefined}
            />
            <StatCard
              label="近 7 日任务事件"
              value={data.stats.taskEvents7d}
              onClick={can(PERMISSIONS.AUDIT_READ) ? () => navigateAdmin('/admin/task-events') : undefined}
            />
            <StatCard label="后台人员" value={data.stats.staffUsers} />
          </div>

          <div className="flex flex-wrap gap-2">
            <QuickLink label="系统状态" path="/admin/system-status" />
            {can(PERMISSIONS.USERS_ROLE_WRITE) ? <QuickLink label="成员邀请" path="/admin/staff-invites" /> : null}
            {can(PERMISSIONS.COMPANION_READ) ? <QuickLink label="伴侣发行" path="/admin/companion-artifacts" /> : null}
            {can(PERMISSIONS.GEMINI_FAIRNESS_READ) ? (
              <QuickLink label="Gemini 限流" path="/admin/gemini-fairness" />
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
              <h3 className="text-[11px] font-semibold text-gray-300">云空间 Top</h3>
              <ul className="mt-3 space-y-2">
                {data.storage.top.map((row) => (
                  <li key={row.userId} className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-300 truncate max-w-[55%]">{row.username || row.email}</span>
                    <span className="text-gray-500">
                      {fmtMb(row.usedBytes)} / {fmtMb(row.quotaBytes)} ({pct(row.usagePct)})
                    </span>
                  </li>
                ))}
                {!data.storage.top.length ? <li className="text-[11px] text-gray-600">暂无数据</li> : null}
              </ul>
            </div>

            <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
              <h3 className="text-[11px] font-semibold text-gray-300">配额预警（≥80%）</h3>
              <ul className="mt-3 space-y-2">
                {data.storage.nearQuota.map((row) => (
                  <li key={row.userId} className="flex items-center justify-between text-[11px]">
                    <span className="text-amber-200/90 truncate max-w-[55%]">{row.username || row.email}</span>
                    <span className="text-amber-600/80">{pct(row.usagePct)}</span>
                  </li>
                ))}
                {!data.storage.nearQuota.length ? <li className="text-[11px] text-gray-600">暂无预警用户</li> : null}
              </ul>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
              <h3 className="text-[11px] font-semibold text-gray-300">伴侣发行（win32）</h3>
              <dl className="mt-3 space-y-2 text-[11px]">
                <div>
                  <dt className="text-gray-500 text-[10px] uppercase">stable</dt>
                  {data.companion ? (
                    <dd className="mt-1 flex justify-between text-gray-200">
                      <span className="font-mono">{data.companion.semver}</span>
                      <span className="text-gray-500">{new Date(data.companion.publishedAt).toLocaleString()}</span>
                    </dd>
                  ) : (
                    <dd className="mt-1 text-gray-600">暂无 stable 记录</dd>
                  )}
                </div>
                <div>
                  <dt className="text-gray-500 text-[10px] uppercase">beta</dt>
                  {data.companionBeta ? (
                    <dd className="mt-1 flex justify-between text-gray-200">
                      <span className="font-mono">{data.companionBeta.semver}</span>
                      <span className="text-gray-500">{new Date(data.companionBeta.publishedAt).toLocaleString()}</span>
                    </dd>
                  ) : (
                    <dd className="mt-1 text-gray-600">暂无 beta 记录</dd>
                  )}
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
              <h3 className="text-[11px] font-semibold text-gray-300">服务健康</h3>
              <dl className="mt-3 space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <dt className="text-gray-500">auth-api</dt>
                  <dd className="text-emerald-300">正常</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500 shrink-0">gemini-proxy</dt>
                  <dd className="text-right text-gray-300">
                    {data.health.geminiProxy.skipped
                      ? data.health.geminiProxy.reason || '未配置'
                      : data.health.geminiProxy.ok
                        ? '正常'
                        : data.health.geminiProxy.error || `HTTP ${data.health.geminiProxy.status ?? '?'}`}
                  </dd>
                </div>
              </dl>
              {!data.health.geminiProxy.skipped && !data.health.geminiProxy.ok ? (
                <p className="mt-2 text-[10px] text-amber-600/90 leading-relaxed">
                  请在 auth-api 环境变量配置 GEMINI_PROXY_HEALTH_URL；Render 多实例时限流 JSON 可能与 proxy 不同步。
                </p>
              ) : null}
              {data.health.geminiProxy.metrics ? (
                <dl className="mt-3 pt-3 border-t border-[#252528] space-y-1.5 text-[10px]">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">公平排队</dt>
                    <dd className={data.health.geminiProxy.metrics.enabled ? 'text-emerald-300' : 'text-gray-500'}>
                      {data.health.geminiProxy.metrics.enabled ? '已启用' : '未启用'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">排队估算</dt>
                    <dd className="text-gray-300">{data.health.geminiProxy.metrics.globalQueuedApprox}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">有排队的 Key</dt>
                    <dd className="text-gray-300">{data.health.geminiProxy.metrics.keysWithQueued}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Proxy 并发中</dt>
                    <dd className="text-gray-300">{data.health.geminiProxy.metrics.geminiProxyInFlight}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">异步任务</dt>
                    <dd className="text-gray-300">{data.health.geminiProxy.metrics.geminiAsyncJobs}</dd>
                  </div>
                  {data.health.geminiProxy.metrics.configSource ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500 shrink-0">配置来源</dt>
                      <dd className="text-gray-400 text-right">{data.health.geminiProxy.metrics.configSource}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              <button
                type="button"
                onClick={() => navigateAdmin('/admin/system-status')}
                className="mt-3 text-[10px] text-blue-400 hover:text-blue-300"
              >
                查看完整系统状态 →
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default AdminDashboardPanel;
