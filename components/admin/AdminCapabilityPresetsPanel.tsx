import React from 'react';
import type { CustomAppModule } from '../../types';
import {
  fetchAdminCapabilityPresets,
  type CapabilityPresetCatalogItem,
  type CapabilityPresetPublishRecord,
} from '../../services/adminClient';
import { publishPresetToUserR2Catalog } from '../../services/capabilityPresetR2Publish';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { useAdminStaff } from './AdminStaffContext';

const AdminCapabilityPresetsPanel: React.FC = () => {
  const { isRolePreview } = useAdminStaff();
  const [configured, setConfigured] = React.useState(true);
  const [catalog, setCatalog] = React.useState<CapabilityPresetCatalogItem[]>([]);
  const [recentPublishes, setRecentPublishes] = React.useState<CapabilityPresetPublishRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [jsonDraft, setJsonDraft] = React.useState('');
  const [publishing, setPublishing] = React.useState(false);
  const [publishMsg, setPublishMsg] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAdminCapabilityPresets();
      setConfigured(res.configured);
      setCatalog(res.catalog);
      setRecentPublishes(res.recentPublishes);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handlePublish = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    const text = jsonDraft.trim();
    if (!text) {
      setPublishMsg('请粘贴 preset JSON');
      return;
    }
    let preset: CustomAppModule;
    try {
      const parsed = JSON.parse(text) as CustomAppModule | CustomAppModule[];
      preset = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!preset?.id || !preset?.label) throw new Error('缺少 id 或 label');
    } catch (err) {
      setPublishMsg(err instanceof Error ? err.message : 'JSON 无效');
      return;
    }
    setPublishing(true);
    setPublishMsg('');
    try {
      const result = await publishPresetToUserR2Catalog({ preset });
      setPublishMsg(`已发布 · ${result.packObjectKey}`);
      setJsonDraft('');
      await load();
    } catch (err) {
      setPublishMsg(err instanceof Error ? err.message : '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">能力预设</h2>
            <p className="mt-1 text-[10px] text-gray-600">R2 公共 catalog · 发布记录来自审计</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-200 hover:bg-[#2e2e36]"
          >
            刷新
          </button>
        </div>
        {!configured ? (
          <p className="text-[11px] text-amber-400/90">R2 未配置，无法读取 catalog 或发布。</p>
        ) : null}
        {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      </div>

      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
        <h3 className="text-[11px] font-semibold text-gray-300">发布 preset</h3>
        <p className="text-[10px] text-gray-600">粘贴单个 CustomAppModule JSON（与工作台导出格式一致）。</p>
        <textarea
          value={jsonDraft}
          onChange={(e) => setJsonDraft(e.target.value)}
          rows={8}
          placeholder='{"id":"...","label":"...","category":"..."}'
          className="w-full rounded-xl border border-[#343438] bg-[#0f0f0f] px-3 py-2 text-[11px] text-gray-200 font-mono outline-none focus:border-[#3b82f6]"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={publishing || !configured}
            onClick={() => void handlePublish()}
            className="px-4 py-2 rounded-xl bg-[#3b82f6] text-[11px] font-medium text-white hover:bg-[#2563eb] disabled:opacity-40"
          >
            {publishing ? '发布中…' : '发布到 R2'}
          </button>
          {publishMsg ? <p className="text-[10px] text-gray-400">{publishMsg}</p> : null}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-6 text-[11px] text-gray-400">加载 catalog…</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#252528]">
              <h3 className="text-[11px] font-semibold text-gray-300">Catalog（{catalog.length}）</h3>
            </div>
            <ul className="max-h-[420px] overflow-y-auto">
              {catalog.map((item) => (
                <li key={String(item.id || item.name)} className="px-4 py-3 border-t border-[#252528] text-[11px]">
                  <p className="text-gray-200 font-medium">{item.name || item.id || '—'}</p>
                  <p className="text-[10px] text-gray-500 font-mono mt-0.5">{item.id}</p>
                  {item.updatedAt ? <p className="text-[10px] text-gray-600 mt-1">更新 {item.updatedAt}</p> : null}
                </li>
              ))}
              {!catalog.length ? <li className="px-4 py-6 text-[11px] text-gray-500">catalog 为空</li> : null}
            </ul>
          </div>

          <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#252528]">
              <h3 className="text-[11px] font-semibold text-gray-300">最近发布</h3>
            </div>
            <ul className="max-h-[420px] overflow-y-auto">
              {recentPublishes.map((row) => (
                <li key={row.id} className="px-4 py-3 border-t border-[#252528] text-[11px]">
                  <p className="text-gray-200">
                    <span className="font-mono text-blue-200/90">{row.presetId || '—'}</span>
                    <span className="text-gray-500 mx-1">·</span>
                    @{row.actorIdentifier || '—'}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">{new Date(row.at).toLocaleString()}</p>
                </li>
              ))}
              {!recentPublishes.length ? (
                <li className="px-4 py-6 text-[11px] text-gray-500">暂无发布记录</li>
              ) : null}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminCapabilityPresetsPanel;
