import React from 'react';
import type { AuthUser } from '../../services/authClient';
import { fetchAdminUsers } from '../../services/adminClient';
import { fmtCredits } from '../../shared/credits';
import { CustomDropdown } from '../ui/CustomDropdown';

const PAGE_SIZE = 15;

const STATUS_FILTER_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '仅启用' },
  { value: 'disabled', label: '仅禁用' },
];

const INPUT_CLASS =
  'w-full rounded-xl border border-[#2e2e32] bg-[#0a0a0c] text-[11px] text-gray-200 px-3 py-2 outline-none focus:border-blue-500/50 disabled:opacity-50';

export type AdminPromoUserPickerProps = {
  selectedIds: ReadonlySet<string>;
  onSelectionChange: (next: Set<string>, usersById: Map<string, AuthUser>) => void;
  disabled?: boolean;
  /** 为 true 时仅允许选一名用户（再选会替换） */
  singleSelect?: boolean;
};

export const AdminPromoUserPicker: React.FC<AdminPromoUserPickerProps> = ({
  selectedIds,
  onSelectionChange,
  disabled = false,
  singleSelect = false,
}) => {
  const [keyword, setKeyword] = React.useState('');
  const [debouncedKeyword, setDebouncedKeyword] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [users, setUsers] = React.useState<AuthUser[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState('');
  const usersByIdRef = React.useRef<Map<string, AuthUser>>(new Map());

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 280);
    return () => window.clearTimeout(t);
  }, [keyword]);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedKeyword, statusFilter]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    void fetchAdminUsers({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedKeyword || undefined,
      status: statusFilter === 'active' || statusFilter === 'disabled' ? statusFilter : undefined,
    })
      .then((res) => {
        if (cancelled) return;
        setUsers(res.users);
        setTotal(res.total ?? res.users.length);
        for (const u of res.users) {
          usersByIdRef.current.set(u.id, u);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setUsers([]);
        setTotal(0);
        setLoadError(e instanceof Error ? e.message : '加载用户失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, debouncedKeyword, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleUser = (user: AuthUser) => {
    if (disabled) return;
    const next = new Set(selectedIds);
    if (singleSelect) {
      if (next.has(user.id)) {
        next.delete(user.id);
      } else {
        next.clear();
        next.add(user.id);
      }
    } else if (next.has(user.id)) {
      next.delete(user.id);
    } else {
      next.add(user.id);
    }
    usersByIdRef.current.set(user.id, user);
    onSelectionChange(next, new Map(usersByIdRef.current));
  };

  const togglePageAll = () => {
    if (disabled || singleSelect) return;
    const pageIds = users.map((u) => u.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) {
      for (const id of pageIds) next.delete(id);
    } else {
      for (const u of users) {
        next.add(u.id);
        usersByIdRef.current.set(u.id, u);
      }
    }
    onSelectionChange(next, new Map(usersByIdRef.current));
  };

  const clearSelection = () => {
    if (disabled) return;
    onSelectionChange(new Set(), new Map(usersByIdRef.current));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[160px] space-y-1">
          <span className="text-[10px] text-gray-500">搜索用户</span>
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="用户名或邮箱"
            disabled={disabled}
            className={INPUT_CLASS}
          />
        </label>
        <div className="min-w-[120px]">
          <p className="text-[10px] text-gray-500 mb-1">状态</p>
          <CustomDropdown
            value={statusFilter}
            options={STATUS_FILTER_OPTIONS}
            onChange={(v) => setStatusFilter(v)}
            ariaLabel="用户状态筛选"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
        <span className="text-gray-500">
          已选 <strong className="text-amber-300/90">{selectedIds.size}</strong> 人
          {singleSelect ? '（单选）' : ''}
        </span>
        <div className="flex gap-2">
          {!singleSelect ? (
            <button
              type="button"
              disabled={disabled || !users.length}
              onClick={togglePageAll}
              className="text-gray-400 hover:text-gray-200 disabled:opacity-40"
            >
              全选本页
            </button>
          ) : null}
          {selectedIds.size > 0 ? (
            <button
              type="button"
              disabled={disabled}
              onClick={clearSelection}
              className="text-gray-400 hover:text-rose-300 disabled:opacity-40"
            >
              清空选择
            </button>
          ) : null}
        </div>
      </div>

      {loadError ? <p className="text-[11px] text-red-400">{loadError}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-[#2e2e32] max-h-[280px] overflow-y-auto">
        <table className="w-full text-[11px] min-w-[480px]">
          <thead className="bg-[#1a1a1f] text-gray-400 sticky top-0 z-[1]">
            <tr>
              <th className="w-10 px-3 py-2" />
              <th className="text-left px-3 py-2 font-medium">用户名</th>
              <th className="text-left px-3 py-2 font-medium">邮箱</th>
              <th className="text-right px-3 py-2 font-medium">余额</th>
              <th className="text-left px-3 py-2 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  加载用户…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  无匹配用户
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const checked = selectedIds.has(user.id);
                return (
                  <tr
                    key={user.id}
                    className={`border-t border-[#2e2e32]/80 cursor-pointer hover:bg-white/[0.03] ${
                      checked ? 'bg-blue-950/20' : ''
                    }`}
                    onClick={() => toggleUser(user)}
                  >
                    <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleUser(user)}
                        className="rounded border-[#3b3b42] bg-[#0a0a0c] text-blue-500 focus:ring-blue-500/40"
                        aria-label={`选择 ${user.username}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-200 font-medium">{user.username}</td>
                    <td className="px-3 py-2 text-gray-500 truncate max-w-[160px]" title={user.email}>
                      {user.email || '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">
                      {user.creditBalance != null ? fmtCredits(user.creditBalance) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {user.status === 'active' ? (
                        <span className="text-emerald-400/80">启用</span>
                      ) : (
                        <span className="text-gray-600">禁用</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
          <span>
            第 {page} / {pageCount} 页 · 共 {total} 人
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled || page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2 py-1 rounded-lg border border-[#3b3b42] hover:bg-white/5 disabled:opacity-40"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={disabled || page >= pageCount || loading}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="px-2 py-1 rounded-lg border border-[#3b3b42] hover:bg-white/5 disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AdminPromoUserPicker;
