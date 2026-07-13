import React from 'react';
import {
  fetchAdminProviderKeys,
  saveAdminProviderKeys,
  type AdminProviderKeyRow,
} from '../../services/adminProviderKeysClient';
import { PERMISSIONS } from '../../services/adminPermissions';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { useAdminStaff } from './AdminStaffContext';

function createDraft(): AdminProviderKeyRow {
  return {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider: 'tripo',
    label: 'Tripo',
    enabled: true,
    priority: 100,
    rpm: 0,
    secret: '',
  };
}

const AdminProviderKeysPanel: React.FC = () => {
  const { can, isRolePreview } = useAdminStaff();
  const canWrite = can(PERMISSIONS.AI_GATEWAY_KEYS_WRITE);
  const [rows, setRows] = React.useState<AdminProviderKeyRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAdminProviderKeys();
      setRows(res.keys.length ? res.keys : [createDraft()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 Key 池失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const updateRow = (id: string, patch: Partial<AdminProviderKeyRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const save = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const cleaned = rows
        .map((row) => ({
          ...row,
          provider: String(row.provider || 'tripo').trim(),
          label: String(row.label || row.provider || 'Tripo').trim(),
          priority: Math.max(1, Math.floor(Number(row.priority) || 100)),
          rpm: Math.max(0, Math.floor(Number(row.rpm) || 0)),
          secret: String(row.secret || '').trim(),
        }))
        .filter((row) => row.provider && (row.secret || row.hasSecret));
      const saved = await saveAdminProviderKeys(cleaned);
      setRows(saved.keys.length ? saved.keys : [createDraft()]);
      setMessage('Key 池已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存 Key 池失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-[11px] text-gray-400">正在加载 Key 池...</div>;

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">AI Key 池</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          AI Gateway worker 使用的服务端供应商 Key 池。Key 只保存在服务端，不会下发给普通用户。
        </p>
      </div>

      {error ? <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-[11px] text-red-200">{error}</div> : null}
      {message ? <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-100">{message}</div> : null}

      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border border-[#2e2e32] bg-[#121216] p-4">
            <div className="grid gap-3 md:grid-cols-[130px_1fr_120px_100px]">
              <label className="block">
                <span className="text-[10px] text-gray-500">供应商</span>
                <input
                  value={row.provider}
                  onChange={(ev) => updateRow(row.id, { provider: ev.target.value })}
                  disabled={!canWrite || saving}
                  className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-500">名称</span>
                <input
                  value={row.label}
                  onChange={(ev) => updateRow(row.id, { label: ev.target.value })}
                  disabled={!canWrite || saving}
                  className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-500">优先级</span>
                <input
                  inputMode="numeric"
                  value={String(row.priority)}
                  onChange={(ev) => updateRow(row.id, { priority: Number(ev.target.value) || 100 })}
                  disabled={!canWrite || saving}
                  className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                />
              </label>
              <label className="flex items-end gap-2 pb-2 text-[11px] text-gray-300">
                <input
                  type="checkbox"
                  checked={row.enabled !== false}
                  onChange={(ev) => updateRow(row.id, { enabled: ev.target.checked })}
                  disabled={!canWrite || saving}
                />
                启用
              </label>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_120px_auto]">
              <label className="block">
                <span className="text-[10px] text-gray-500">
                  API Key {row.secretPreview ? `（当前 ${row.secretPreview}）` : ''}
                </span>
                <input
                  type="password"
                  value={row.secret || ''}
                  onChange={(ev) => updateRow(row.id, { secret: ev.target.value })}
                  disabled={!canWrite || saving}
                  placeholder={row.hasSecret ? '留空则保留现有 Key' : '粘贴 Tripo API Key'}
                  className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-500">每分钟上限</span>
                <input
                  inputMode="numeric"
                  value={String(row.rpm || 0)}
                  onChange={(ev) => updateRow(row.id, { rpm: Number(ev.target.value) || 0 })}
                  disabled={!canWrite || saving}
                  className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                />
              </label>
              <button
                type="button"
                disabled={!canWrite || saving}
                onClick={() => setRows((prev) => prev.filter((item) => item.id !== row.id))}
                className="self-end rounded-lg border border-red-900/50 bg-red-950/25 px-3 py-2 text-[11px] text-red-200 disabled:opacity-40"
              >
                删除
              </button>
            </div>
            {row.runtime ? (
              <div className="mt-3 grid gap-2 border-t border-white/[0.06] pt-3 text-[10px] text-gray-500 md:grid-cols-4">
                <div>
                  <div>上次使用</div>
                  <div className="mt-0.5 text-gray-300">{row.runtime.lastUsedAt ? new Date(row.runtime.lastUsedAt).toLocaleString() : '-'}</div>
                </div>
                <div>
                  <div>本分钟次数</div>
                  <div className="mt-0.5 text-gray-300">{row.runtime.currentMinuteCount ?? 0}{row.rpm ? ` / ${row.rpm}` : ''}</div>
                </div>
                <div>
                  <div>状态</div>
                  <div className={row.runtime.coolingDown ? 'mt-0.5 text-amber-200' : 'mt-0.5 text-emerald-200'}>
                    {row.runtime.coolingDown ? `冷却至 ${row.runtime.cooldownUntil ? new Date(row.runtime.cooldownUntil).toLocaleTimeString() : ''}` : '可用'}
                  </div>
                </div>
                <div>
                  <div>最近错误</div>
                  <div className="mt-0.5 truncate text-gray-300" title={row.runtime.lastError || ''}>
                    {row.runtime.lastError || '-'}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canWrite || saving}
          onClick={() => setRows((prev) => [...prev, createDraft()])}
          className="rounded-lg border border-[#2e2e32] bg-[#1c1c22] px-4 py-2 text-[11px] text-gray-300 disabled:opacity-40"
        >
          添加 Key
        </button>
        <button
          type="button"
          disabled={!canWrite || saving}
          onClick={() => void save()}
          className="rounded-lg bg-[#2563eb] px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-40"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void load()}
          className="rounded-lg border border-[#2e2e32] bg-[#1c1c22] px-4 py-2 text-[11px] text-gray-300 disabled:opacity-40"
        >
          重新加载
        </button>
      </div>
    </div>
  );
};

export default AdminProviderKeysPanel;
