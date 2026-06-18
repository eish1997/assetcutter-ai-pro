import React from 'react';
import type { CustomAppModule } from '../../types';
import {
  deleteAdminCapabilityPreset,
  downloadAdminCapabilityPresetsBackup,
  extractPresetIdFromCatalogItem,
  fetchAdminCapabilityPresets,
  importAdminCapabilityPresets,
  previewAdminCapabilityPresetsImport,
  type CapabilityPresetBackup,
  type CapabilityPresetCatalogItem,
  type CapabilityPresetImportMode,
  type CapabilityPresetImportPreview,
  type CapabilityPresetPublishRecord,
} from '../../services/adminClient';
import { publishPresetToUserR2Catalog } from '../../services/capabilityPresetR2Publish';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { useAdminStaff } from './AdminStaffContext';

function formatImportPreviewSummary(preview: CapabilityPresetImportPreview, mode: CapabilityPresetImportMode): string {
  const lines = [
    `模式：${mode === 'overwrite' ? '覆盖恢复' : '智能合并'}`,
    `将写入 ${preview.willWriteCount} 条（新增 ${preview.added.length}，更新 ${preview.updated.length}）`,
    `最终 catalog ${preview.finalCatalogCount} 条`,
  ];
  if (mode === 'overwrite' && preview.willDeleteCount > 0) {
    lines.push(`将删除线上独有 ${preview.willDeleteCount} 条`);
  }
  if (mode === 'merge' && preview.unchanged.length > 0) {
    lines.push(`保留不变 ${preview.unchanged.length} 条`);
  }
  if (preview.conflicts.length > 0) {
    lines.push(`版本冲突 ${preview.conflicts.length} 条（按 version 较新/相等时备份优先）`);
  }
  return lines.join('\n');
}

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
  const [backingUp, setBackingUp] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [importMsg, setImportMsg] = React.useState('');
  const [deletingId, setDeletingId] = React.useState('');
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const pendingImportModeRef = React.useRef<CapabilityPresetImportMode>('merge');

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

  const handleBackup = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setBackingUp(true);
    setImportMsg('');
    try {
      const { filename } = await downloadAdminCapabilityPresetsBackup();
      setImportMsg(`已下载备份 · ${filename}`);
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : '备份失败');
    } finally {
      setBackingUp(false);
    }
  };

  const startImport = (mode: CapabilityPresetImportMode) => {
    if (blockIfRolePreview(isRolePreview)) return;
    if (mode === 'overwrite') {
      const ok = window.confirm(
        '覆盖模式会用备份替换线上 catalog，并删除备份中不存在的已发布预设。建议先备份。确认继续选择文件？'
      );
      if (!ok) return;
    }
    pendingImportModeRef.current = mode;
    importInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const mode = pendingImportModeRef.current;
    setImporting(true);
    setImportMsg('');
    try {
      const text = await file.text();
      const backup = JSON.parse(text) as CapabilityPresetBackup;
      const { preview } = await previewAdminCapabilityPresetsImport(backup, mode);
      const ok = window.confirm(
        `${formatImportPreviewSummary(preview, mode)}\n\n确认执行导入？`
      );
      if (!ok) {
        setImportMsg('已取消导入');
        return;
      }
      const result = await importAdminCapabilityPresets(backup, mode);
      setImportMsg(
        `导入完成 · 写入 ${result.writtenCount} 条${result.deletedCount ? `，删除 ${result.deletedCount} 条` : ''}，catalog ${result.finalCatalogCount} 条`
      );
      await load();
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (item: CapabilityPresetCatalogItem) => {
    if (blockIfRolePreview(isRolePreview)) return;
    const presetId = extractPresetIdFromCatalogItem(item);
    if (!presetId) return;
    const label = item.name || presetId;
    const ok = window.confirm(
      `将从 R2 公共 catalog 下架「${label}」（${presetId}），并删除对应 preset 包与预览图。此操作不可自动撤销，请确认已备份。`
    );
    if (!ok) return;
    setDeletingId(presetId);
    setImportMsg('');
    try {
      await deleteAdminCapabilityPreset(presetId);
      setImportMsg(`已删除 · ${presetId}`);
      await load();
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">能力预设</h2>
            <p className="mt-1 text-[10px] text-gray-600">
              R2 公共 catalog · 备份含 catalog 与 preset JSON（不含预览图二进制）· 发布记录来自审计
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={backingUp || !configured}
              onClick={() => void handleBackup()}
              className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-200 hover:bg-[#2e2e36] disabled:opacity-40"
            >
              {backingUp ? '备份中…' : '备份到本地'}
            </button>
            <button
              type="button"
              disabled={importing || !configured}
              onClick={() => startImport('merge')}
              className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-200 hover:bg-[#2e2e36] disabled:opacity-40"
            >
              智能合并导入
            </button>
            <button
              type="button"
              disabled={importing || !configured}
              onClick={() => startImport('overwrite')}
              className="px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-100 hover:bg-amber-500/20 disabled:opacity-40"
            >
              覆盖导入
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-200 hover:bg-[#2e2e36]"
            >
              刷新
            </button>
          </div>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => void handleImportFile(e)}
        />
        {!configured ? (
          <p className="text-[11px] text-amber-400/90">R2 未配置，无法读取 catalog 或发布。</p>
        ) : null}
        {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
        {importMsg ? <p className="text-[11px] text-gray-400">{importMsg}</p> : null}
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
              {catalog.map((item) => {
                const presetId = extractPresetIdFromCatalogItem(item);
                return (
                  <li key={String(item.id || item.name)} className="px-4 py-3 border-t border-[#252528] text-[11px]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-gray-200 font-medium truncate">{item.name || item.id || '—'}</p>
                        <p className="text-[10px] text-gray-500 font-mono mt-0.5 truncate">{item.id}</p>
                        {presetId ? (
                          <p className="text-[10px] text-gray-600 font-mono mt-0.5 truncate">presetId: {presetId}</p>
                        ) : null}
                        {item.updatedAt ? <p className="text-[10px] text-gray-600 mt-1">更新 {item.updatedAt}</p> : null}
                      </div>
                      <button
                        type="button"
                        disabled={!configured || !presetId || deletingId === presetId}
                        onClick={() => void handleDelete(item)}
                        className="shrink-0 px-2.5 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-[10px] text-red-200 hover:bg-red-500/20 disabled:opacity-40"
                      >
                        {deletingId === presetId ? '删除中…' : '删除'}
                      </button>
                    </div>
                  </li>
                );
              })}
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
