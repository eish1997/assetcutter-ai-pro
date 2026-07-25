import React from 'react';
import {
  batchPromoGrantAdminCredits,
  fetchAdminPromoLots,
  fetchAdminPromoSummary,
  grantAdminPromoCredits,
  revokeAdminPromoLot,
  type AdminPromoCampaignSummary,
  type AdminPromoLotRow,
} from '../../services/adminClient';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { navigateAdmin } from '../../services/adminNavigate';
import { fmtCredits, fmtPromoExpiryDate } from '../../shared/credits';
import { CustomDropdown } from '../ui/CustomDropdown';
import { useAdminStaff } from './AdminStaffContext';
import AdminPromoUserPicker from './AdminPromoUserPicker';
import type { AuthUser } from '../../services/authClient';
import {
  PROMO_EXPIRY_PRESETS,
  defaultPromoCustomExpiryLocal,
  previewPromoExpiresAt,
  resolvePromoExpiresAt,
} from './promoGrantFormHelpers';

const LOT_STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '有效' },
  { value: 'expired', label: '已到期' },
  { value: 'depleted', label: '已用完' },
  { value: 'revoked', label: '已撤销' },
];

const INPUT_CLASS =
  'w-full rounded-xl border border-[#2e2e32] bg-[#0a0a0c] text-[11px] text-gray-200 px-3 py-2 outline-none focus:border-blue-500/50 disabled:opacity-50';

function fmtIsoShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function downloadCampaignSummaryCsv(campaigns: AdminPromoCampaignSummary[]) {
  const header = 'campaignId,userCount,totalGranted,activeRemaining,expiredAmount,nearestExpiry,lastGrantAt';
  const lines = campaigns.map((c) =>
    [
      c.campaignId,
      c.userCount,
      c.totalGranted,
      c.activeRemaining,
      c.expiredAmount,
      c.nearestExpiry || '',
      c.lastGrantAt || '',
    ].join(',')
  );
  const blob = new Blob([`\uFEFF${header}\n${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `promo-campaigns-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const AdminPromoCreditsPanel: React.FC = () => {
  const { isRolePreview } = useAdminStaff();
  const [enabled, setEnabled] = React.useState(true);
  const [campaigns, setCampaigns] = React.useState<AdminPromoCampaignSummary[]>([]);
  const [lots, setLots] = React.useState<AdminPromoLotRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [campaignFilter, setCampaignFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [revokingId, setRevokingId] = React.useState('');

  const [grantMode, setGrantMode] = React.useState<'multi' | 'single'>('multi');
  const [campaignId, setCampaignId] = React.useState('');
  const [grantNote, setGrantNote] = React.useState('');
  const [expiryPreset, setExpiryPreset] = React.useState('+30d');
  const [customExpiry, setCustomExpiry] = React.useState(defaultPromoCustomExpiryLocal);
  const [selectedUserIds, setSelectedUserIds] = React.useState<Set<string>>(() => new Set());
  const [selectedUsersById, setSelectedUsersById] = React.useState<Map<string, AuthUser>>(() => new Map());
  const [grantAmount, setGrantAmount] = React.useState('');
  const [grantBusy, setGrantBusy] = React.useState(false);
  const [grantError, setGrantError] = React.useState('');
  const [grantSummary, setGrantSummary] = React.useState('');
  const [grantResults, setGrantResults] = React.useState<
    Awaited<ReturnType<typeof batchPromoGrantAdminCredits>>['results'] | null
  >(null);

  const expiryPreview = previewPromoExpiresAt(expiryPreset, customExpiry);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryRes, lotsRes] = await Promise.all([
        fetchAdminPromoSummary(),
        fetchAdminPromoLots({
          campaignId: campaignFilter || undefined,
          status: statusFilter || undefined,
          limit: 80,
        }),
      ]);
      setEnabled(summaryRes.enabled);
      setCampaigns(summaryRes.campaigns || []);
      setLots(lotsRes.lots || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载活动积分失败');
    } finally {
      setLoading(false);
    }
  }, [campaignFilter, statusFilter]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const campaignOptions = React.useMemo(() => {
    const opts = [{ value: '', label: '全部活动' }];
    for (const c of campaigns) {
      opts.push({ value: c.campaignId, label: c.campaignId });
    }
    return opts;
  }, [campaigns]);

  const buildGrantContext = () => {
    const note = grantNote.trim();
    const camp = campaignId.trim() || 'default';
    if (!note) throw new Error('请填写发放备注（用户流水可见）');
    const expiresAt = resolvePromoExpiresAt(expiryPreset, customExpiry);
    return { note, campaignId: camp, expiresAt };
  };

  const handleSelectionChange = React.useCallback((next: Set<string>, usersById: Map<string, AuthUser>) => {
    setSelectedUserIds(next);
    setSelectedUsersById((prev) => {
      const merged = new Map(prev);
      for (const id of next) {
        const u = usersById.get(id);
        if (u) merged.set(id, u);
      }
      for (const id of merged.keys()) {
        if (!next.has(id)) merged.delete(id);
      }
      return merged;
    });
  }, []);

  const runGrant = async (dryRun: boolean) => {
    if (blockIfRolePreview(isRolePreview)) return;
    setGrantBusy(true);
    setGrantError('');
    setGrantSummary('');
    setGrantResults(null);
    try {
      const ctx = buildGrantContext();
      const amount = Math.floor(Number(grantAmount));
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('积分须为正整数');

      const ids = [...selectedUserIds];
      if (grantMode === 'single' && ids.length !== 1) {
        throw new Error('请选择一名用户');
      }
      if (!ids.length) throw new Error('请至少勾选一名用户');

      const rows = ids.map((id) => {
        const user = selectedUsersById.get(id);
        if (!user?.username) throw new Error('所选用户信息不完整，请重新勾选');
        return {
          username: user.username,
          delta: amount,
          note: ctx.note,
          expiresAt: ctx.expiresAt,
          campaignId: ctx.campaignId,
        };
      });

      if (grantMode === 'single' && rows.length === 1) {
        if (dryRun) {
          setGrantSummary(`预览：将向 ${rows[0].username} 发放 ${fmtCredits(amount)} 积分`);
          setGrantResults([
            { username: rows[0].username, delta: amount, status: 'dry_run', campaignId: ctx.campaignId },
          ]);
          return;
        }
        const res = await grantAdminPromoCredits({
          userId: ids[0],
          amount,
          note: ctx.note,
          expiresAt: ctx.expiresAt,
          campaignId: ctx.campaignId,
        });
        setGrantSummary(
          res.duplicate
            ? '已存在相同发放记录（幂等跳过）'
            : `已发放 ${fmtCredits(amount)} 给 ${rows[0].username}，余额 ${fmtCredits(res.balanceAfter)}`
        );
        setSelectedUserIds(new Set());
        setGrantAmount('');
        void load();
        return;
      }

      const res = await batchPromoGrantAdminCredits({ rows, dryRun });
      setGrantResults(res.results || []);
      setGrantSummary(
        dryRun
          ? `预览：成功 ${res.successCount}，跳过 ${res.skipped}，失败 ${res.failed}`
          : `完成：成功 ${res.successCount}，跳过 ${res.skipped}，失败 ${res.failed}`
      );
      if (!dryRun && res.successCount > 0) {
        setSelectedUserIds(new Set());
        setGrantAmount('');
        void load();
      }
    } catch (e) {
      setGrantError(e instanceof Error ? e.message : '发放失败');
    } finally {
      setGrantBusy(false);
    }
  };

  const revokeLot = async (lot: AdminPromoLotRow) => {
    if (blockIfRolePreview(isRolePreview)) return;
    if (lot.status !== 'active' || lot.remaining <= 0) return;
    if (!window.confirm(`撤销 ${lot.username || lot.userId} 的 ${fmtCredits(lot.remaining)} 活动积分？`)) return;
    setRevokingId(lot.id);
    setError('');
    try {
      await revokeAdminPromoLot(lot.id, '管理员撤销');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '撤销失败');
    } finally {
      setRevokingId('');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">活动积分（限时）</h1>
        <p className="text-[11px] text-gray-400 mt-1 leading-relaxed max-w-3xl">
          发放带到期日的活动积分；用户消耗时优先扣活动桶（按到期先后）。到期后自动清零，流水类型为「活动到期清零」。
          {' '}
          <button
            type="button"
            onClick={() => navigateAdmin('/admin/users')}
            className="text-blue-400 hover:text-blue-300"
          >
            用户管理（永久账本）
          </button>
          {' · '}
          <button
            type="button"
            onClick={() => navigateAdmin('/admin/usage')}
            className="text-blue-400 hover:text-blue-300"
          >
            AI 用量
          </button>
        </p>
        {!enabled ? (
          <p className="text-[11px] text-amber-300/90 mt-2">
            环境变量 <code className="text-amber-100">CREDITS_PROMO_LOTS_ENABLED</code> 未开启。
          </p>
        ) : null}
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      <section className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-5 space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90">发放活动积分</h2>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className="text-[10px] text-gray-500">活动 ID</span>
            <input
              type="text"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              placeholder="如 2026-07-summer"
              disabled={!enabled || grantBusy}
              className={INPUT_CLASS}
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[10px] text-gray-500">发放备注（必填，用户可见）</span>
            <input
              type="text"
              value={grantNote}
              onChange={(e) => setGrantNote(e.target.value)}
              placeholder="如：7月限时活动"
              disabled={!enabled || grantBusy}
              className={INPUT_CLASS}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-gray-500">有效期</span>
            <CustomDropdown
              value={expiryPreset}
              options={[...PROMO_EXPIRY_PRESETS]}
              onChange={(v) => setExpiryPreset(v)}
              ariaLabel="活动积分有效期"
              disabled={!enabled || grantBusy}
            />
          </label>
        </div>

        {expiryPreset === 'custom' ? (
          <label className="block space-y-1 max-w-xs">
            <span className="text-[10px] text-gray-500">到期时间</span>
            <input
              type="datetime-local"
              value={customExpiry}
              onChange={(e) => setCustomExpiry(e.target.value)}
              disabled={!enabled || grantBusy}
              className={INPUT_CLASS}
            />
          </label>
        ) : null}

        {expiryPreview ? (
          <p className="text-[10px] text-gray-500">预计到期：{expiryPreview}</p>
        ) : null}

        <div className="flex gap-2 border-b border-[#2e2e32] pb-1">
          <button
            type="button"
            onClick={() => setGrantMode('multi')}
            className={`px-3 py-1.5 rounded-lg text-[11px] ${
              grantMode === 'multi' ? 'bg-white/10 text-gray-100' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            多人（勾选）
          </button>
          <button
            type="button"
            onClick={() => {
              setGrantMode('single');
              if (selectedUserIds.size > 1) {
                const first = [...selectedUserIds][0];
                handleSelectionChange(new Set(first ? [first] : []), selectedUsersById);
              }
            }}
            className={`px-3 py-1.5 rounded-lg text-[11px] ${
              grantMode === 'single' ? 'bg-white/10 text-gray-100' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            单人
          </button>
        </div>

        <AdminPromoUserPicker
          selectedIds={selectedUserIds}
          onSelectionChange={handleSelectionChange}
          disabled={!enabled || grantBusy}
          singleSelect={grantMode === 'single'}
        />

        <div className="grid gap-3 sm:grid-cols-[160px_auto] items-end max-w-md">
          <label className="space-y-1">
            <span className="text-[10px] text-gray-500">
              {grantMode === 'single' ? '发放积分' : '每人积分'}
            </span>
            <input
              type="number"
              min={1}
              value={grantAmount}
              onChange={(e) => setGrantAmount(e.target.value)}
              placeholder="20000"
              disabled={!enabled || grantBusy}
              className={INPUT_CLASS}
            />
          </label>
          <div className="flex flex-wrap gap-2 pb-0.5">
            {grantMode === 'multi' ? (
              <button
                type="button"
                disabled={!enabled || grantBusy}
                onClick={() => void runGrant(true)}
                className="px-4 py-2 rounded-xl text-[11px] border border-[#3b3b42] bg-[#1c1c22] text-gray-200 hover:bg-[#2a2a32] disabled:opacity-50 h-[38px]"
              >
                预览
              </button>
            ) : null}
            <button
              type="button"
              disabled={!enabled || grantBusy}
              onClick={() => void runGrant(false)}
              className="px-4 py-2 rounded-xl text-[11px] border border-blue-600/50 bg-blue-950/40 text-blue-100 hover:bg-blue-900/50 disabled:opacity-50 h-[38px]"
            >
              {grantBusy
                ? '处理中…'
                : grantMode === 'single'
                  ? '确认发放'
                  : `确认发放 ${selectedUserIds.size} 人`}
            </button>
          </div>
        </div>

        {grantError ? <p className="text-[11px] text-red-400">{grantError}</p> : null}
        {grantSummary ? <p className="text-[11px] text-emerald-300/90">{grantSummary}</p> : null}
        {grantResults?.length ? (
          <div className="overflow-x-auto rounded-xl border border-[#2e2e32] max-h-40 overflow-y-auto">
            <table className="w-full text-[10px]">
              <thead className="bg-[#1a1a1f] text-gray-400 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">用户</th>
                  <th className="text-right px-3 py-2">积分</th>
                  <th className="text-left px-3 py-2">状态</th>
                </tr>
              </thead>
              <tbody>
                {grantResults.map((row, i) => (
                  <tr key={`${row.username}-${i}`} className="border-t border-[#2e2e32]/80">
                    <td className="px-3 py-1.5 text-gray-200">{row.username}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-300">
                      {row.delta != null ? fmtCredits(row.delta) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-gray-400">{row.error || row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90">活动汇总</h2>
          {campaigns.length > 0 ? (
            <button
              type="button"
              onClick={() => downloadCampaignSummaryCsv(campaigns)}
              className="px-3 py-1.5 rounded-lg text-[10px] border border-[#3b3b42] text-gray-400 hover:text-gray-200"
            >
              导出 CSV
            </button>
          ) : null}
        </div>
        {loading ? (
          <p className="text-[11px] text-gray-500">加载中…</p>
        ) : campaigns.length === 0 ? (
          <p className="text-[11px] text-gray-500">暂无活动积分记录。</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#2e2e32]">
            <table className="w-full text-[10px] min-w-[720px]">
              <thead className="bg-[#1a1a1f] text-gray-400">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">活动 ID</th>
                  <th className="text-right px-3 py-2 font-medium">用户数</th>
                  <th className="text-right px-3 py-2 font-medium">发放总量</th>
                  <th className="text-right px-3 py-2 font-medium">有效剩余</th>
                  <th className="text-right px-3 py-2 font-medium">已到期</th>
                  <th className="text-left px-3 py-2 font-medium">最近到期</th>
                  <th className="text-left px-3 py-2 font-medium">最近发放</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((row) => (
                  <tr key={row.campaignId} className="border-t border-[#2e2e32]/80">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setCampaignFilter(row.campaignId)}
                        className="text-gray-200 font-mono hover:text-blue-300 underline-offset-2 hover:underline"
                        title="筛选下方明细"
                      >
                        {row.campaignId}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300">{row.userCount}</td>
                    <td className="px-3 py-2 text-right text-gray-300">{fmtCredits(row.totalGranted)}</td>
                    <td className="px-3 py-2 text-right text-emerald-300/90">{fmtCredits(row.activeRemaining)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtCredits(row.expiredAmount)}</td>
                    <td className="px-3 py-2 text-gray-400">
                      {row.nearestExpiry ? fmtPromoExpiryDate(row.nearestExpiry) : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{fmtIsoShort(row.lastGrantAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-5 space-y-3">
        <div className="flex flex-wrap items-end gap-3 justify-between">
          <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90">积分桶明细</h2>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-[160px]">
              <CustomDropdown
                value={campaignFilter}
                options={campaignOptions}
                onChange={(v) => setCampaignFilter(v)}
                ariaLabel="按活动筛选"
              />
            </div>
            <div className="min-w-[120px]">
              <CustomDropdown
                value={statusFilter}
                options={LOT_STATUS_OPTIONS}
                onChange={(v) => setStatusFilter(v)}
                ariaLabel="按状态筛选"
              />
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="px-3 py-2 rounded-xl text-[11px] border border-[#3b3b42] text-gray-300 hover:bg-white/5"
            >
              刷新
            </button>
          </div>
        </div>
        {loading ? (
          <p className="text-[11px] text-gray-500">加载中…</p>
        ) : lots.length === 0 ? (
          <p className="text-[11px] text-gray-500">无匹配记录。</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#2e2e32]">
            <table className="w-full text-[10px] min-w-[880px]">
              <thead className="bg-[#1a1a1f] text-gray-400">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">用户</th>
                  <th className="text-left px-3 py-2 font-medium">活动</th>
                  <th className="text-right px-3 py-2 font-medium">发放</th>
                  <th className="text-right px-3 py-2 font-medium">剩余</th>
                  <th className="text-left px-3 py-2 font-medium">状态</th>
                  <th className="text-left px-3 py-2 font-medium">到期</th>
                  <th className="text-left px-3 py-2 font-medium">备注</th>
                  <th className="text-right px-3 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.id} className="border-t border-[#2e2e32]/80">
                    <td className="px-3 py-2 text-gray-200">{lot.username || lot.userId}</td>
                    <td className="px-3 py-2 text-gray-400 font-mono">{lot.campaignId}</td>
                    <td className="px-3 py-2 text-right text-gray-300">{fmtCredits(lot.amount)}</td>
                    <td className="px-3 py-2 text-right text-emerald-300/90">{fmtCredits(lot.remaining)}</td>
                    <td className="px-3 py-2 text-gray-400">{lot.status}</td>
                    <td className="px-3 py-2 text-gray-400">
                      {lot.expiresAt ? fmtPromoExpiryDate(lot.expiresAt) : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-500 max-w-[140px] truncate" title={lot.note || ''}>
                      {lot.note || '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {lot.status === 'active' && lot.remaining > 0 ? (
                        <button
                          type="button"
                          disabled={revokingId === lot.id}
                          onClick={() => void revokeLot(lot)}
                          className="text-[10px] text-rose-300/90 hover:text-rose-200 disabled:opacity-50"
                        >
                          {revokingId === lot.id ? '…' : '撤销'}
                        </button>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default AdminPromoCreditsPanel;
