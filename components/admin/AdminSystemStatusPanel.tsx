import React from 'react';
import {
  fetchAdminAlertWebhook,
  fetchAdminSystemStatus,
  testAdminAlertWebhook,
  updateAdminAlertWebhook,
  type AdminAlertWebhookConfig,
  type AdminSystemStatusPayload,
} from '../../services/adminClient';
import { PERMISSIONS } from '../../services/adminPermissions';
import { navigateAdmin } from '../../services/adminNavigate';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { useAdminStaff } from './AdminStaffContext';

function statusLabel(ok: boolean, skipped?: boolean, reason?: string) {
  if (skipped) return reason || '未配置';
  return ok ? '正常' : '异常';
}

function statusClass(ok: boolean, skipped?: boolean) {
  if (skipped) return 'text-gray-500';
  return ok ? 'text-emerald-300' : 'text-red-400';
}

const AdminSystemStatusPanel: React.FC = () => {
  const { can, isRolePreview } = useAdminStaff();
  const canEditWebhook = can(PERMISSIONS.ROLES_WRITE);
  const [status, setStatus] = React.useState<AdminSystemStatusPayload | null>(null);
  const [webhook, setWebhook] = React.useState<AdminAlertWebhookConfig | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [webhookUrl, setWebhookUrl] = React.useState('');
  const [webhookEnabled, setWebhookEnabled] = React.useState(false);
  const [webhookThreshold, setWebhookThreshold] = React.useState(20);
  const [webhookWindow, setWebhookWindow] = React.useState(60);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [msg, setMsg] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const statusRes = await fetchAdminSystemStatus();
      setStatus(statusRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWebhook = React.useCallback(async () => {
    if (!canEditWebhook) return;
    try {
      const wh = await fetchAdminAlertWebhook();
      setWebhook(wh.config);
      setWebhookUrl(wh.config.url);
      setWebhookEnabled(wh.config.enabled);
      setWebhookThreshold(wh.config.loginFailedThreshold);
      setWebhookWindow(wh.config.loginFailedWindowMinutes);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '告警配置加载失败');
    }
  }, [canEditWebhook]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    void loadWebhook();
  }, [loadWebhook]);

  const saveWebhook = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await updateAdminAlertWebhook({
        enabled: webhookEnabled,
        url: webhookUrl.trim(),
        loginFailedThreshold: webhookThreshold,
        loginFailedWindowMinutes: webhookWindow,
      });
      setWebhook(res.config);
      setWebhookUrl(res.config.url);
      setMsg('已保存');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setTesting(true);
    setMsg('');
    try {
      await testAdminAlertWebhook();
      setMsg('测试消息已发送');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '测试失败');
    } finally {
      setTesting(false);
    }
  };

  if (loading && !status) {
    return <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-6 text-[11px] text-gray-400">加载系统状态…</div>;
  }

  const gp = status?.services.aiWorkerProxy;
  const ps = status?.services.promoSweep;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">系统状态</h2>
          {status?.generatedAt ? (
            <p className="mt-1 text-[10px] text-gray-600">生成于 {new Date(status.generatedAt).toLocaleString()}</p>
          ) : null}
          {can(PERMISSIONS.GEMINI_FAIRNESS_READ) ? (
            <p className="mt-1 text-[10px] text-gray-600">
              <button
                type="button"
                onClick={() => navigateAdmin('/admin/gemini-fairness')}
                className="text-blue-400 hover:text-blue-300"
              >
                编辑 Gemini 公平限流
              </button>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-200 hover:bg-[#2e2e36]"
        >
          刷新
        </button>
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      {status ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
              <h3 className="text-[11px] font-semibold text-gray-300">服务</h3>
              <dl className="mt-3 space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <dt className="text-gray-500">auth-api</dt>
                  <dd className="text-emerald-300">正常 · 端口 {status.services.authApi.port}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500 shrink-0">AI Worker Proxy</dt>
                  <dd className={`text-right ${statusClass(Boolean(gp?.ok), gp?.skipped)}`}>
                    {statusLabel(Boolean(gp?.ok), gp?.skipped, gp?.reason || gp?.error)}
                  </dd>
                </div>
                {gp?.url ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500 shrink-0">探测 URL</dt>
                    <dd className="text-gray-500 text-right truncate max-w-[60%]" title={gp.url}>
                      {gp.url}
                    </dd>
                  </div>
                ) : null}
                {ps?.enabled ? (
                  <>
                    <div className="flex justify-between gap-4 pt-2 border-t border-[#252528]">
                      <dt className="text-gray-500 shrink-0">活动积分 sweep</dt>
                      <dd className={statusClass(ps.lastOk !== false)}>
                        {ps.lastOk === false
                          ? `异常 · 连续失败 ${ps.consecutiveFailures}/${ps.alertThreshold}`
                          : ps.lastRunAt
                            ? '正常'
                            : '尚未运行'}
                      </dd>
                    </div>
                    {ps.lastRunAt ? (
                      <div className="flex justify-between gap-4">
                        <dt className="text-gray-500 shrink-0">最近 sweep</dt>
                        <dd className="text-gray-500 text-right">{new Date(ps.lastRunAt).toLocaleString()}</dd>
                      </div>
                    ) : null}
                    {ps.lastError ? (
                      <div className="flex justify-between gap-4">
                        <dt className="text-gray-500 shrink-0">最近错误</dt>
                        <dd className="text-red-400/90 text-right truncate max-w-[60%]" title={ps.lastError}>
                          {ps.lastError}
                        </dd>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </dl>
              {gp?.metrics ? (
                <dl className="mt-3 pt-3 border-t border-[#252528] space-y-1.5 text-[10px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">公平排队</dt>
                    <dd className={`text-right ${gp.metrics.enabled ? 'text-emerald-300' : 'text-gray-500'}`}>
                      {gp.metrics.enabled ? '已启用' : '未启用'}
                      {can(PERMISSIONS.GEMINI_FAIRNESS_READ) ? (
                        <>
                          {' · '}
                          <button
                            type="button"
                            onClick={() => navigateAdmin('/admin/gemini-fairness')}
                            className="text-blue-400 hover:text-blue-300"
                          >
                            配置
                          </button>
                        </>
                      ) : null}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">排队估算</dt>
                    <dd className="text-gray-300">{gp.metrics.globalQueuedApprox}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Proxy 并发中</dt>
                    <dd className="text-gray-300">{gp.metrics.aiWorkerProxyInFlight}</dd>
                  </div>
                </dl>
              ) : null}
            </div>

            <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
              <h3 className="text-[11px] font-semibold text-gray-300">环境与配置</h3>
              <ul className="mt-3 space-y-1.5">
                {status.config.flags.map((f) => (
                  <li key={f.name} className="flex justify-between text-[11px]">
                    <span className="text-gray-500">{f.name}</span>
                    <span className={f.configured ? 'text-emerald-300' : 'text-gray-600'}>
                      {f.configured ? '已配置' : '未配置'}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 pt-3 border-t border-[#252528] space-y-1.5 text-[10px]">
                <div className="flex justify-between">
                  <dt className="text-gray-500">试用 Gemini 日限额</dt>
                  <dd className="text-gray-300">{status.config.trialGeminiDailyLimit}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500 shrink-0">限流配置来源</dt>
                  <dd className="text-gray-400 text-right">{status.config.geminiFairnessConfigSource || '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">伴侣发行登记数</dt>
                  <dd className="text-gray-300">{status.config.companionArtifactsRegistered}</dd>
                </div>
              </dl>
            </div>
          </div>

          {canEditWebhook ? (
            <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
              <div>
                <h3 className="text-[11px] font-semibold text-gray-300">告警 Webhook</h3>
                <p className="mt-1 text-[10px] text-gray-600">
                  登录失败超阈值时 POST 通知（15 分钟冷却）。当前 URL：{webhook?.urlMasked || '未配置'}
                </p>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-gray-300">
                <input
                  type="checkbox"
                  checked={webhookEnabled}
                  onChange={(e) => setWebhookEnabled(e.target.checked)}
                  className="rounded border-[#2e2e32]"
                />
                启用告警
              </label>
              <label className="block text-[10px] text-gray-500">
                Webhook URL
                <input
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0b] px-2 py-2 text-[11px] text-gray-200"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[10px] text-gray-500">
                  登录失败阈值
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={webhookThreshold}
                    onChange={(e) => setWebhookThreshold(Number(e.target.value) || 20)}
                    className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0b] px-2 py-2 text-[11px] text-gray-200"
                  />
                </label>
                <label className="block text-[10px] text-gray-500">
                  统计窗口（分钟）
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={webhookWindow}
                    onChange={(e) => setWebhookWindow(Number(e.target.value) || 60)}
                    className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0b] px-2 py-2 text-[11px] text-gray-200"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveWebhook()}
                  className="rounded-lg border border-blue-600 bg-blue-700/80 px-4 py-2 text-[11px] font-bold text-white hover:bg-blue-600 disabled:opacity-45"
                >
                  {saving ? '保存中…' : '保存配置'}
                </button>
                <button
                  type="button"
                  disabled={testing}
                  onClick={() => void runTest()}
                  className="rounded-lg border border-[#3f3f46] bg-[#1a1a1c] px-4 py-2 text-[11px] text-gray-200 hover:bg-[#252528] disabled:opacity-45"
                >
                  {testing ? '发送中…' : '发送测试'}
                </button>
              </div>
              {msg ? <p className="text-[10px] text-gray-400">{msg}</p> : null}
            </div>
          ) : (
            <p className="text-[10px] text-gray-600">告警 Webhook 配置需「角色写」权限。</p>
          )}
        </>
      ) : null}
    </div>
  );
};

export default AdminSystemStatusPanel;
