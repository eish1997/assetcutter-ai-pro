import React from 'react';
import { CustomDropdown } from '../ui/CustomDropdown';
import {
  createAdminStaffInvite,
  fetchAdminStaffInvites,
  revokeAdminStaffInvite,
  type AdminStaffInvite,
} from '../../services/adminClient';
import { fetchAdminRoles, type AdminRoleRow } from '../../services/adminRolesClient';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { useAdminStaff } from './AdminStaffContext';

function inviteStatus(inv: AdminStaffInvite): { label: string; className: string } {
  if (inv.revokedAt) return { label: '已撤销', className: 'text-gray-500' };
  if (inv.usedAt) return { label: '已使用', className: 'text-emerald-300' };
  if (new Date(inv.expiresAt).getTime() <= Date.now()) return { label: '已过期', className: 'text-amber-400' };
  return { label: '待使用', className: 'text-blue-300' };
}

const AdminStaffInvitesPanel: React.FC = () => {
  const { isRolePreview } = useAdminStaff();
  const [invites, setInvites] = React.useState<AdminStaffInvite[]>([]);
  const [roles, setRoles] = React.useState<AdminRoleRow[]>([]);
  const [staffRoleId, setStaffRoleId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [ttlDays, setTtlDays] = React.useState(7);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [createdLink, setCreatedLink] = React.useState('');
  const [copyMsg, setCopyMsg] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [invRes, rolesRes] = await Promise.all([fetchAdminStaffInvites(), fetchAdminRoles()]);
      setInvites(invRes.invites);
      const eligible = rolesRes.roles.filter((r) => r.slug !== 'super');
      setRoles(eligible);
      setStaffRoleId((cur) => cur || eligible[0]?.id || '');
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
    if (!staffRoleId) {
      setError('请选择角色');
      return;
    }
    setBusy(true);
    setError('');
    setCreatedLink('');
    try {
      const res = await createAdminStaffInvite({ staffRoleId, note, ttlDays });
      const fullUrl = `${window.location.origin}${res.registerPath}`;
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
      await revokeAdminStaffInvite(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤销失败');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
      setCopyMsg('已复制');
    } catch {
      setCopyMsg('复制失败，请手动选择复制');
    }
  };

  const roleOptions = roles.map((r) => ({
    value: r.id,
    label: `${r.displayName} (${r.slug})`,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">成员邀请</h2>
        <p className="mt-1 text-[10px] text-gray-600">生成注册链接，新用户注册后自动获得后台角色（不可邀请 super）</p>
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
        <h3 className="text-[11px] font-semibold text-gray-300">创建邀请</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="block text-[10px] text-gray-500">
            后台角色
            <div className="mt-1">
              <CustomDropdown
                value={staffRoleId}
                onChange={setStaffRoleId}
                options={roleOptions}
                triggerClassName="w-full bg-[#0a0a0b] border border-[#2e2e32] rounded-lg px-3 py-2 text-[11px] text-left text-gray-200 flex items-center justify-between outline-none focus:border-blue-500 hover:bg-[#121214] transition-colors"
              />
            </div>
          </div>
          <label className="block text-[10px] text-gray-500">
            有效天数（1～30）
            <input
              type="number"
              min={1}
              max={30}
              value={ttlDays}
              onChange={(e) => setTtlDays(Number(e.target.value) || 7)}
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
          disabled={busy || !roleOptions.length}
          onClick={() => void onCreate()}
          className="rounded-lg border border-blue-600 bg-blue-700/80 px-4 py-2 text-[11px] font-bold text-white hover:bg-blue-600 disabled:opacity-45"
        >
          {busy ? '处理中…' : '生成邀请链接'}
        </button>
        {createdLink ? (
          <div className="rounded-lg border border-[#2e2e32] bg-[#0a0a0b] p-3 space-y-2">
            <p className="text-[10px] text-emerald-300">邀请已创建，请复制链接发给对方（仅显示一次完整 token）：</p>
            <code className="block text-[10px] text-gray-300 break-all">{createdLink}</code>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="text-[10px] text-blue-400 hover:text-blue-300"
            >
              复制链接
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
          <div className="p-6 text-[11px] text-gray-500">暂无邀请</div>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[#2e2e32] text-[9px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2">角色</th>
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
                    <td className="px-3 py-2 text-gray-200">{inv.staffRoleDisplayName || inv.staffRoleSlug}</td>
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

export default AdminStaffInvitesPanel;
