import React from 'react';
import {
  createAdminPriceCatalogVersion,
  fetchAdminPriceCatalog,
  patchAdminPriceCatalog,
  type AdminPriceCatalogEntry,
  type AdminPriceCatalogWriteInput,
} from '../../services/adminClient';
import { PERMISSIONS, hasAdminPermission } from '../../services/adminPermissions';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { listModelRoutes, type ModelRouteCatalogEntry } from '../../services/modelRegistry';
import { fmtCredits } from '../../shared/credits';
import { CustomDropdown } from '../ui/CustomDropdown';
import { useAdminStaff } from './AdminStaffContext';

const METER_KIND_OPTIONS = [
  { value: 'token', label: 'token' },
  { value: 'image', label: 'image' },
  { value: 'task', label: 'task' },
  { value: 'second', label: 'second' },
  { value: 'byte', label: 'byte' },
];

type EditDraft = {
  displayName: string;
  userCreditsPerUnit: string;
  perUnit: string;
  inputPer1m: string;
  outputPer1m: string;
  imageOutputPer1m: string;
  enabled: boolean;
  effectiveFrom: string;
  meterKind: string;
};

export type AiGatewayPriceSkuSuggestion = {
  billingSku: string;
  displayName: string;
  providerId: string;
  canonicalModelId: string;
  providerModelId: string;
  modality: string;
  meterKind: string;
  routeEnabled: boolean;
};

function isoToDatetimeLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function draftFromEntry(entry: AdminPriceCatalogEntry): EditDraft {
  return {
    displayName: entry.displayName || '',
    userCreditsPerUnit: entry.userCreditsPerUnit != null ? String(entry.userCreditsPerUnit) : '',
    perUnit: entry.perUnit != null ? String(entry.perUnit) : '',
    inputPer1m: entry.inputPer1m != null ? String(entry.inputPer1m) : '',
    outputPer1m: entry.outputPer1m != null ? String(entry.outputPer1m) : '',
    imageOutputPer1m: entry.imageOutputPer1m != null ? String(entry.imageOutputPer1m) : '',
    enabled: entry.enabled !== false,
    effectiveFrom: isoToDatetimeLocal(entry.effectiveFrom),
    meterKind: entry.meterKind || 'task',
  };
}

function parseOptionalField(raw: string): number | null | undefined {
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error('数值字段须为有效数字');
  return n;
}

function draftToPayload(draft: EditDraft, billingSku?: string): AdminPriceCatalogWriteInput {
  return {
    ...(billingSku ? { billingSku } : {}),
    displayName: draft.displayName.trim() || null,
    meterKind: draft.meterKind,
    userCreditsPerUnit: parseOptionalField(draft.userCreditsPerUnit),
    perUnit: parseOptionalField(draft.perUnit),
    inputPer1m: parseOptionalField(draft.inputPer1m),
    outputPer1m: parseOptionalField(draft.outputPer1m),
    imageOutputPer1m: parseOptionalField(draft.imageOutputPer1m),
    enabled: draft.enabled,
    effectiveFrom: draft.effectiveFrom ? new Date(draft.effectiveFrom).toISOString() : undefined,
  };
}

function compactSkuPart(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function geminiRouteSku(modality: string, model: string): string {
  if (modality === 'image') return model.includes('pro') && !model.includes('flash') ? 'image.gemini.pro' : 'image.gemini.flash';
  return model.includes('pro') && !model.includes('flash') ? 'llm.gemini.pro' : 'llm.gemini.flash';
}

function openAiOfficialRouteSku(modality: string, model: string): string {
  if (modality === 'image') {
    if (model.includes('gpt-image-2')) return 'image.openai.gpt2';
    if (model.includes('gpt-image-1.5') || model.includes('gpt-image-15')) return 'image.openai.gpt15';
  }
  if (modality === 'text') {
    if (model.includes('gpt-4o-mini')) return 'llm.openai.gpt4o-mini';
    if (model.includes('gpt-4o')) return 'llm.openai.gpt4o';
  }
  return '';
}

export function meterKindForAiGatewayPriceSuggestion(modality: string): string {
  if (modality === 'text') return 'token';
  if (modality === 'image') return 'image';
  if (modality === 'video') return 'second';
  return 'task';
}

export function billingSkuForAiGatewayRouteSuggestion(route: Pick<ModelRouteCatalogEntry, 'providerId' | 'providerModelId' | 'canonicalModelId' | 'modality'>): string {
  const modality = String(route.modality || 'ai').trim();
  const providerId = String(route.providerId || 'gateway').trim();
  const model = String(route.providerModelId || route.canonicalModelId || 'task').trim().toLowerCase();
  if (modality === 'model3d') {
    if (providerId === 'tencent-hunyuan') return model.includes('rapid') ? '3d.tencent.rapid' : '3d.tencent.pro';
    if (providerId === 'tripo') return '3d.tripo.task';
  }
  if (modality === 'video') {
    if (providerId === 'volcengine-jimeng') return 'video.jimeng.ti2v-v30-pro';
    return 'video.workflow.task';
  }
  if (providerId === 'vertex-site' || providerId === 'vertex-gemini' || model.includes('gemini')) {
    return geminiRouteSku(modality, model);
  }
  const official = providerId === 'openai-official' ? openAiOfficialRouteSku(modality, model) : '';
  if (official) return official;
  return `${modality}.${compactSkuPart(providerId)}.${compactSkuPart(model || route.canonicalModelId || 'task') || 'task'}`.slice(0, 120);
}

export function buildAiGatewayPriceSkuSuggestions(
  entries: readonly Pick<AdminPriceCatalogEntry, 'billingSku'>[],
  routes: readonly ModelRouteCatalogEntry[] = listModelRoutes()
): AiGatewayPriceSkuSuggestion[] {
  const existing = new Set(entries.map((entry) => String(entry.billingSku || '').trim()).filter(Boolean));
  const bySku = new Map<string, AiGatewayPriceSkuSuggestion>();
  for (const route of routes) {
    if (route.gatewayExecutionStatus !== 'gateway_ready') continue;
    const billingSku = billingSkuForAiGatewayRouteSuggestion(route);
    if (!billingSku || existing.has(billingSku) || bySku.has(billingSku)) continue;
    bySku.set(billingSku, {
      billingSku,
      displayName: `${route.providerId} ${route.providerModelId || route.canonicalModelId}`,
      providerId: route.providerId,
      canonicalModelId: route.canonicalModelId,
      providerModelId: route.providerModelId,
      modality: route.modality,
      meterKind: meterKindForAiGatewayPriceSuggestion(route.modality),
      routeEnabled: route.enabled,
    });
  }
  return [...bySku.values()].sort((a, b) => a.providerId.localeCompare(b.providerId) || a.billingSku.localeCompare(b.billingSku));
}

const emptyDraft = (): EditDraft => ({
  displayName: '',
  userCreditsPerUnit: '',
  perUnit: '',
  inputPer1m: '',
  outputPer1m: '',
  imageOutputPer1m: '',
  enabled: true,
  effectiveFrom: '',
  meterKind: 'task',
});

const AdminPriceCatalogPanel: React.FC = () => {
  const { permissions, isRolePreview } = useAdminStaff();
  const canRead =
    hasAdminPermission(permissions, PERMISSIONS.PRICING_WRITE) ||
    hasAdminPermission(permissions, PERMISSIONS.USAGE_READ);
  const canWrite = hasAdminPermission(permissions, PERMISSIONS.PRICING_WRITE);
  const [catalogVersion, setCatalogVersion] = React.useState('');
  const [entries, setEntries] = React.useState<AdminPriceCatalogEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [editEntry, setEditEntry] = React.useState<AdminPriceCatalogEntry | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<EditDraft>(emptyDraft());
  const [newSku, setNewSku] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const aiGatewaySkuSuggestions = React.useMemo(() => buildAiGatewayPriceSkuSuggestions(entries), [entries]);

  const load = React.useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchAdminPriceCatalog();
      setCatalogVersion(res.catalogVersion);
      setEntries(res.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [canRead]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (entry: AdminPriceCatalogEntry) => {
    setEditEntry(entry);
    setDraft(draftFromEntry(entry));
    setCreateOpen(false);
  };

  const openCreate = () => {
    setEditEntry(null);
    setCreateOpen(true);
    setNewSku('');
    setDraft(emptyDraft());
  };

  const openCreateFromSuggestion = (suggestion: AiGatewayPriceSkuSuggestion) => {
    setEditEntry(null);
    setCreateOpen(true);
    setNewSku(suggestion.billingSku);
    setDraft({
      ...emptyDraft(),
      displayName: suggestion.displayName,
      meterKind: suggestion.meterKind,
    });
  };

  const closeModal = () => {
    setEditEntry(null);
    setCreateOpen(false);
    setDraft(emptyDraft());
    setNewSku('');
  };

  const save = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    if (!canWrite) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (createOpen) {
        const sku = newSku.trim();
        if (!sku) throw new Error('请填写 billingSku');
        const res = await createAdminPriceCatalogVersion(draftToPayload(draft, sku));
        setMessage(`已创建 ${res.entry.billingSku} v${res.entry.version}`);
      } else if (editEntry) {
        const res = await patchAdminPriceCatalog(editEntry.billingSku, draftToPayload(draft));
        setMessage(`已更新 ${res.entry.billingSku} → v${res.entry.version}`);
      }
      closeModal();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!canRead) {
    return <p className="text-[12px] text-gray-500 p-4">无价目表查看权限。</p>;
  }

  const modalOpen = createOpen || Boolean(editEntry);

  return (
    <div className="space-y-4 p-4 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">价目表</h1>
          <p className="text-[11px] text-gray-500 mt-1">
            运行时价目版本 · 修改会追加新版本（catalog: {catalogVersion || '—'}）
          </p>
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={openCreate}
            className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-[11px] text-amber-200 hover:bg-amber-500/30"
          >
            新建 SKU
          </button>
        ) : null}
      </div>

      {message ? <p className="text-[11px] text-emerald-400">{message}</p> : null}
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      {aiGatewaySkuSuggestions.length ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold text-amber-100">AI Gateway 待补价 SKU</div>
              <div className="mt-0.5 text-[10px] text-gray-500">
                这些 SKU 已出现在模型路由里，但还没有价目表条目。
              </div>
            </div>
            <span className="text-[10px] text-amber-200">{aiGatewaySkuSuggestions.length} 个</span>
          </div>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            {aiGatewaySkuSuggestions.slice(0, 8).map((item) => (
              <div key={item.billingSku} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[10px] text-gray-200" title={item.billingSku}>{item.billingSku}</div>
                  <div className="mt-0.5 truncate text-[10px] text-gray-500" title={`${item.providerId} / ${item.canonicalModelId}`}>
                    {item.providerId} / {item.modality} / {item.meterKind}
                    {item.routeEnabled ? '' : ' / 路由未启用'}
                  </div>
                </div>
                {canWrite ? (
                  <button
                    type="button"
                    onClick={() => openCreateFromSuggestion(item)}
                    className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-500/20"
                  >
                    新建
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-[#2e2e32] overflow-hidden">
        <div className="px-3 py-2 border-b border-[#2e2e32] text-[10px] text-gray-500 flex justify-between">
          <span>共 {entries.length} 个 SKU</span>
          {loading ? <span>加载中…</span> : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-[#2e2e32]">
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">展示名</th>
                <th className="px-3 py-2 font-medium">用户积分/单位</th>
                <th className="px-3 py-2 font-medium">成本 USD</th>
                <th className="px-3 py-2 font-medium">计量</th>
                <th className="px-3 py-2 font-medium">版本</th>
                <th className="px-3 py-2 font-medium">生效</th>
                <th className="px-3 py-2 font-medium">状态</th>
                {canWrite ? <th className="px-3 py-2 font-medium" /> : null}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.billingSku} className="border-b border-[#2e2e32]/60 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 text-gray-300 font-mono text-[10px]">{entry.billingSku}</td>
                  <td className="px-3 py-2 text-gray-200">{entry.displayName || '—'}</td>
                  <td className="px-3 py-2 text-amber-400">
                    {entry.userCreditsPerUnit != null ? fmtCredits(entry.userCreditsPerUnit) : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-400">
                    {entry.perUnit != null
                      ? `$${entry.perUnit}`
                      : entry.inputPer1m != null
                        ? `in ${entry.inputPer1m} / out ${entry.outputPer1m ?? '—'}`
                        : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{entry.meterKind}</td>
                  <td className="px-3 py-2 text-gray-500">v{entry.version}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {entry.effectiveFrom ? new Date(entry.effectiveFrom).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={entry.enabled ? 'text-emerald-400' : 'text-gray-500'}>
                      {entry.enabled ? '启用' : '停用'}
                    </span>
                  </td>
                  {canWrite ? (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => openEdit(entry)}
                        className="text-[10px] text-gray-400 hover:text-white"
                      >
                        编辑
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!loading && entries.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 9 : 8} className="px-3 py-8 text-center text-gray-500">
                    暂无价目条目
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70">
          <div className="w-full max-w-lg rounded-2xl border border-[#2e2e32] bg-[#121216] shadow-2xl">
            <div className="px-5 py-4 border-b border-[#2e2e32]">
              <h2 className="text-sm font-semibold text-white">
                {createOpen ? '新建 SKU 版本' : `编辑 ${editEntry?.billingSku}`}
              </h2>
              <p className="text-[10px] text-gray-500 mt-1">保存后将追加新版本并立即生效（若 effectiveFrom ≤ 现在）</p>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {createOpen ? (
                <label className="block text-[10px] text-gray-500">
                  billingSku
                  <input
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white/5 border border-[#2e2e32] text-[11px] text-gray-200"
                    placeholder="image.gemini.pro"
                  />
                </label>
              ) : null}
              <label className="block text-[10px] text-gray-500">
                展示名
                <input
                  value={draft.displayName}
                  onChange={(e) => setDraft((d) => ({ ...d, displayName: e.target.value }))}
                  className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white/5 border border-[#2e2e32] text-[11px] text-gray-200"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-[10px] text-gray-500">
                  用户积分/单位
                  <input
                    value={draft.userCreditsPerUnit}
                    onChange={(e) => setDraft((d) => ({ ...d, userCreditsPerUnit: e.target.value }))}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white/5 border border-[#2e2e32] text-[11px] text-gray-200"
                    placeholder="留空则从 perUnit 推导"
                  />
                </label>
                <label className="block text-[10px] text-gray-500">
                  成本 USD / 单位
                  <input
                    value={draft.perUnit}
                    onChange={(e) => setDraft((d) => ({ ...d, perUnit: e.target.value }))}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white/5 border border-[#2e2e32] text-[11px] text-gray-200"
                  />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="block text-[10px] text-gray-500">
                  input / 1M
                  <input
                    value={draft.inputPer1m}
                    onChange={(e) => setDraft((d) => ({ ...d, inputPer1m: e.target.value }))}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white/5 border border-[#2e2e32] text-[11px] text-gray-200"
                  />
                </label>
                <label className="block text-[10px] text-gray-500">
                  output / 1M
                  <input
                    value={draft.outputPer1m}
                    onChange={(e) => setDraft((d) => ({ ...d, outputPer1m: e.target.value }))}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white/5 border border-[#2e2e32] text-[11px] text-gray-200"
                  />
                </label>
                <label className="block text-[10px] text-gray-500">
                  image out / 1M
                  <input
                    value={draft.imageOutputPer1m}
                    onChange={(e) => setDraft((d) => ({ ...d, imageOutputPer1m: e.target.value }))}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white/5 border border-[#2e2e32] text-[11px] text-gray-200"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-[10px] text-gray-500">
                  计量类型
                  <div className="mt-1">
                    <CustomDropdown
                      value={draft.meterKind}
                      options={METER_KIND_OPTIONS}
                      onChange={(v) => setDraft((d) => ({ ...d, meterKind: v }))}
                    />
                  </div>
                </label>
                <label className="block text-[10px] text-gray-500">
                  生效时间
                  <input
                    type="datetime-local"
                    value={draft.effectiveFrom}
                    onChange={(e) => setDraft((d) => ({ ...d, effectiveFrom: e.target.value }))}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white/5 border border-[#2e2e32] text-[11px] text-gray-200"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-gray-300">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                  className="rounded border-[#2e2e32]"
                />
                启用
              </label>
            </div>
            <div className="px-5 py-4 border-t border-[#2e2e32] flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="px-3 py-1.5 rounded-lg text-[11px] text-gray-400 hover:text-gray-200"
              >
                取消
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="px-3 py-1.5 rounded-lg bg-white/10 text-[11px] text-gray-200 hover:bg-white/15 disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存新版本'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AdminPriceCatalogPanel;
