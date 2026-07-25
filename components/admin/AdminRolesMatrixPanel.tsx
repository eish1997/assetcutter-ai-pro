import React from 'react';
import {
  createAdminRole,
  deleteAdminRole,
  fetchAdminPermissionColumns,
  fetchAdminRoles,
  saveAdminRolePermissions,
  type AdminRoleRow,
  type MatrixColumnMeta,
} from '../../services/adminRolesClient';
import type { MatrixCellValue } from '../../services/adminMatrix';
import { cellLabel, matrixToPermissions, nextRwCell, nextToggleCell } from '../../services/adminMatrix';
import { PERMISSIONS, resolveAdminLandingPath } from '../../services/adminPermissions';
import { blockIfRolePreview, writeAdminRolePreviewSession } from '../../services/adminRolePreview';
import { navigateAdmin } from '../../services/adminNavigate';
import { useAdminStaff } from './AdminStaffContext';

const AdminRolesMatrixPanel: React.FC = () => {
  const { can, isRolePreview, me, reload } = useAdminStaff();
  const canWrite = can(PERMISSIONS.ROLES_WRITE);
  const [roles, setRoles] = React.useState<AdminRoleRow[]>([]);
  const [columns, setColumns] = React.useState<MatrixColumnMeta[]>([]);
  const [drafts, setDrafts] = React.useState<Record<string, Record<string, MatrixCellValue>>>({});
  const [loading, setLoading] = React.useState(true);
  const [savingId, setSavingId] = React.useState('');
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [newSlug, setNewSlug] = React.useState('');
  const [newName, setNewName] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rolesRes, colsRes] = await Promise.all([fetchAdminRoles(), fetchAdminPermissionColumns()]);
      setRoles(rolesRes.roles);
      setColumns(colsRes.columns);
      const nextDrafts: Record<string, Record<string, MatrixCellValue>> = {};
      for (const role of rolesRes.roles) {
        nextDrafts[role.id] = { ...role.matrix };
      }
      setDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const toggleCell = (roleId: string, col: MatrixColumnMeta) => {
    if (blockIfRolePreview(isRolePreview)) return;
    if (!canWrite) return;
    const role = roles.find((r) => r.id === roleId);
    if (!role || role.slug === 'super') return;
    setDrafts((prev) => {
      const row = { ...(prev[roleId] || {}) };
      const current = (row[col.id] || 'none') as MatrixCellValue;
      row[col.id] = col.kind === 'toggle' ? nextToggleCell(current) : nextRwCell(current);
      return { ...prev, [roleId]: row };
    });
  };

  const handleSaveRole = async (roleId: string) => {
    if (blockIfRolePreview(isRolePreview)) return;
    setSavingId(roleId);
    setError('');
    setMessage('');
    try {
      const res = await saveAdminRolePermissions(roleId, drafts[roleId] || {});
      setRoles((prev) => prev.map((r) => (r.id === roleId ? res.role : r)));
      setDrafts((prev) => ({ ...prev, [roleId]: { ...res.role.matrix } }));
      if (me?.staffRole?.id === roleId) {
        await reload();
      }
      setMessage('权限已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingId('');
    }
  };

  const handleCreate = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setError('');
    setMessage('');
    try {
      await createAdminRole({ slug: newSlug.trim(), displayName: newName.trim() });
      setNewSlug('');
      setNewName('');
      setMessage('角色已创建');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
  };

  const handleDelete = async (role: AdminRoleRow) => {
    if (blockIfRolePreview(isRolePreview)) return;
    if (!window.confirm(`删除角色「${role.displayName}」？`)) return;
    setError('');
    try {
      await deleteAdminRole(role.id);
      setMessage('角色已删除');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (loading) {
    return <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-6 text-[11px] text-gray-400">加载角色矩阵…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
        <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">角色与权限矩阵</h2>
        <p className="mt-1 text-[10px] text-gray-500 max-w-3xl leading-relaxed">
          仅超级管理员可编辑。super 行锁定；admin 系统模板可改列权限但不可删除。带「高危」标记的列不可授予非 super 角色（保存时服务端会剔除）。
          矩阵列与侧栏一一对应；「用户管理」与「用量同步」可独立开关。开启「用户写/改角色」时会自动附带用户列表只读。
          保存后若改的是当前登录账号所属角色，侧栏会立即刷新。
          {' · '}
          <button
            type="button"
            onClick={() => navigateAdmin('/admin/users')}
            className="text-blue-400 hover:text-blue-300"
          >
            用户管理（指派角色）
          </button>
        </p>
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {message ? <p className="text-[11px] text-emerald-300">{message}</p> : null}

      {canWrite ? (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 flex flex-wrap gap-2 items-end">
          <label className="space-y-1">
            <span className="text-[10px] text-gray-500">slug</span>
            <input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              className="block rounded-lg border border-[#343438] bg-[#16161a] px-3 py-2 text-[11px] text-white outline-none focus:border-[#3b82f6]"
              placeholder="ops_viewer"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-gray-500">显示名</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="block rounded-lg border border-[#343438] bg-[#16161a] px-3 py-2 text-[11px] text-white outline-none focus:border-[#3b82f6]"
              placeholder="只读运营"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              void handleCreate();
            }}
            className="px-3 py-2 rounded-xl border border-[#3b6fb8] bg-[#1e3a5f] text-[10px] text-blue-200 hover:bg-[#2a5080]"
          >
            新建自定义角色
          </button>
        </div>
      ) : null}

      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] overflow-x-auto">
        <table className="w-full text-[10px] min-w-[960px]">
          <thead className="bg-[#151518] text-gray-400">
            <tr>
              <th className="text-left px-3 py-2 sticky left-0 bg-[#151518] z-10">角色</th>
              <th className="text-left px-2 py-2">用户</th>
              {columns.map((col) => (
                <th key={col.id} className="text-center px-2 py-2 whitespace-nowrap">
                  {col.label}
                  {col.superOnly ? <span className="block text-[9px] text-amber-600/80">高危</span> : null}
                </th>
              ))}
              <th className="text-left px-2 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => {
              const rowDraft = drafts[role.id] || role.matrix;
              const locked = role.slug === 'super' || !canWrite;
              return (
                <tr key={role.id} className="border-t border-[#252528]">
                  <td className="px-3 py-2 sticky left-0 bg-[#121214] z-10">
                    <div className="text-gray-200">{role.displayName}</div>
                    <div className="text-[9px] text-gray-600">{role.slug}</div>
                  </td>
                  <td className="px-2 py-2 text-gray-500">{role.userCount}</td>
                  {columns.map((col) => {
                    const value = (rowDraft[col.id] || 'none') as MatrixCellValue;
                    const cellLocked =
                      locked || (Boolean(col.superOnly) && role.slug !== 'super');
                    return (
                      <td key={col.id} className="px-1 py-1 text-center">
                        <button
                          type="button"
                          disabled={cellLocked}
                          onClick={() => toggleCell(role.id, col)}
                          className="min-w-[44px] px-1 py-1 rounded border border-[#2e2e32] bg-[#1c1c22] text-gray-300 disabled:opacity-40 hover:bg-[#2e2e36]"
                          title={cellLabel(col.kind, value)}
                        >
                          {cellLabel(col.kind, value)}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={locked || savingId === role.id}
                        onClick={() => {
                          void handleSaveRole(role.id);
                        }}
                        className="px-2 py-1 rounded-lg border border-[#3b6fb8] bg-[#1e3a5f] text-blue-200 disabled:opacity-40"
                      >
                        保存
                      </button>
                      {!role.isSystem && canWrite ? (
                        <button
                          type="button"
                          disabled={role.userCount > 0}
                          onClick={() => {
                            void handleDelete(role);
                          }}
                          className="px-2 py-1 rounded-lg border border-[#dc6b6b] bg-[#3a1818] text-red-200 disabled:opacity-40"
                          title={role.userCount > 0 ? '仍有用户绑定' : '删除自定义角色'}
                        >
                          删除
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          const matrix = rowDraft;
                          const permissions = matrixToPermissions(matrix, role.slug);
                          writeAdminRolePreviewSession({
                            roleId: role.id,
                            slug: role.slug,
                            displayName: role.displayName,
                            permissions,
                          });
                          navigateAdmin(resolveAdminLandingPath(permissions));
                        }}
                        className="px-2 py-1 rounded-lg border border-[#2e2e32] bg-[#1c1c22] text-gray-300 hover:bg-[#2e2e36]"
                        title="以该角色权限模拟完整管理后台界面"
                      >
                        预览
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminRolesMatrixPanel;
