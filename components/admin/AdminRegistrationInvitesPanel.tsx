import React from 'react';
import {
  createAdminRegistrationInvite,
  fetchAdminRegistrationInvites,
  revokeAdminRegistrationInvite,
  type AdminRegistrationInvite,
} from '../../services/adminClient';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { useAdminStaff } from './AdminStaffContext';

function inviteStatus(inv: AdminRegistrationInvite): { label: string; className: string } {
  if (inv.revokedAt) return { label: '已撤销', className: 'text-gray-500' };
  if (inv.usedAt) return { label: '已使用', className: 'text-emerald-300' };
  if (new Date(inv.expiresAt).getTime() <= Date.now()) return { label: '已过期', className: 'text-amber-400' };
  return { label: '待使用', className: 'text-blue-300' };
}

const AdminRegistrationInvitesPanel: React.FC = () => {
  const { isRolePreview } = useAdminStaff();
  const [invites, setInvites] = React.useState<AdminRegistrationInvite[]>([]);
  const [note, setNote] = React.useState('');
  const [ttlDays, setTtlDays] = React.useState(30);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [createdCode, setCreatedCode] = React.useState('');
  const [createdLink, setCreatedLink] = React.useState('');
  const [copyMsg, setCopyMsg] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAdminRegistrationInvites();
      setInvites(res.invites);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setBusy(true);
    setError('');
    setCreatedCode('');
    setCreatedLink('');
    try {
      const res = await createAdminRegistrationInvite({ note, ttlDays });
      const fullUrl = `${window.location.origin}${res.registerPath}`;
      setCreatedCode(res.code);
      setCreatedLink(fullUrl);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (id: string) => {
    if (blockIfRolePreview(isRolePreview)) return;
    setBusy(true);
    setError('');
    try {
      await revokeAdminRegistrationInvite(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤销失败');
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(`${label}已复制`);
    } catch {
      setCopyMsg('复制失败，请手动选择复制');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">注册邀请码</h2>
        <p className="mt-1 text-[10px] text-gray-600">
          一次性短码 + 注册链接；用户注册后不会自动发放积分，需在用户管理中手动发放
        </p>
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
        <h3 className="text-[11px] font-semibold text-gray-300">创建邀请码</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[10px] text-gray-500">
            有效天数（1～90）
            <input
              type="number"
              min={1}
              max={90}
              value={ttlDays}
              onChange={(e) => setTtlDays(Number(e.target.value) || 30)}
              className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0b] px-2 py-2 text-[11px] text-gray-200"
            />
          </label>
          <label className="block text-[10px] text-gray-500 sm:col-span-2">
            备注（可选）
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0b] px-2 py-2 text-[11px] text-gray-200"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onCreate()}
          className="rounded-lg border border-blue-600 bg-blue-700/80 px-4 py-2 text-[11px] font-bold text-white hover:bg-blue-600 disabled:opacity-45"
        >
          {busy ? '处理中…' : '生成邀请码'}
        </button>
        {createdCode ? (
          <div className="rounded-lg border border-[#2e2e32] bg-[#0a0a0b] p-3 space-y-2">
            <p className="text-[10px] text-emerald-300">邀请码已创建（一次性，请立即复制发给用户）：</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-[12px] font-mono text-white tracking-wider">{createdCode}</code>
              <button
                type="button"
                onClick={() => void copyText(createdCode, '邀请码')}
                className="text-[10px] text-blue-400 hover:text-blue-300"
              >
                复制短码
              </button>
            </div>
            <code className="block text-[10px] text-gray-400 break-all">{createdLink}</code>
            <button
              type="button"
              onClick={() => void copyText(createdLink, '注册链接')}
              className="text-[10px] text-blue-400 hover:text-blue-300"
            >
              复制注册链接
            </button>
            {copyMsg ? <p className="text-[10px] text-gray-500">{copyMsg}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-[#2e2e32] overflow-hidden">
        <div className="px-4 py-2 border-b border-[#2e2e32] bg-[#16161a] flex justify-between items-center">
          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400">邀请记录</span>
          <button type="button" onClick={() => void load()} className="text-[10px] text-blue-400 hover:text-blue-300">
            刷新
          </button>
        </div>
        {loading ? (
          <div className="p-6 text-[11px] text-gray-500">加载中…</div>
        ) : invites.length === 0 ? (
          <div className="p-6 text-[11px] text-gray-500">暂无邀请码</div>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[#2e2e32] text-[9px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2">邀请码</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">创建</th>
                <th className="px-3 py-2">过期</th>
                <th className="px-3 py-2">备注</th>
                <th className="px-3 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => {
                const st = inviteStatus(inv);
                const canRevoke = !inv.usedAt && !inv.revokedAt && st.label === '待使用';
                return (
                  <tr key={inv.id} className="border-b border-[#2e2e32]/80">
                    <td className="px-3 py-2 font-mono text-gray-200">{inv.code}</td>
                    <td className={`px-3 py-2 ${st.className}`}>{st.label}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{inv.createdAt.slice(0, 19)}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{inv.expiresAt.slice(0, 19)}</td>
                    <td className="px-3 py-2 text-gray-400 truncate max-w-[140px]" title={inv.note}>
                      {inv.note || '—'}
                    </td>
                    <td className="px-3 py-2">
                      {canRevoke ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onRevoke(inv.id)}
                          className="text-red-400 hover:text-red-300 text-[10px]"
                        >
                          撤销
                        </button>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default AdminRegistrationInvitesPanel;
