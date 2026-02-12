import React, { useEffect, useMemo, useState } from 'react';
import type { CustomAppModule, StoreCatalogItem } from '../types';
import {
  loadInstalledPacks,
  loadPackHistory,
  pushPackHistory,
  saveInstalledPacks,
  type InstalledStorePack,
  type StorePackVersionSnapshot,
} from '../services/storePackHistory';
import { loadCapabilityPresets, mergeCapabilityPresets, saveCapabilityPresets } from '../services/capabilityPresetStore';

/** 默认商店 Catalog（可被 VITE_STORE_CATALOG_URL 覆盖） */
const FALLBACK_CATALOG_URL = 'https://cdn.jsdelivr.net/gh/eish1997/assetcutter-ai-pro-store@main/store/catalog.json';
const DEFAULT_CATALOG_URL =
  (import.meta as unknown as { env?: Record<string, string> })?.env?.VITE_STORE_CATALOG_URL ||
  FALLBACK_CATALOG_URL;

const STORAGE_KEY_CATALOG_URL = 'ac_store_catalog_url';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`请求失败：${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

function normalizeCatalogItem(x: any): StoreCatalogItem | null {
  if (!x || typeof x !== 'object') return null;
  const id = String(x.id || '').trim();
  const type = String(x.type || '').trim();
  const name = String(x.name || '').trim();
  const version = String(x.version || '').trim();
  const url = String(x.url || '').trim();
  if (!id || !name || !version || !url) return null;
  if (type !== 'capability_presets') return null;
  return {
    id,
    type: 'capability_presets',
    name,
    version,
    url,
    desc: x.desc ? String(x.desc) : undefined,
    sha256: x.sha256 ? String(x.sha256) : undefined,
    updatedAt: x.updatedAt ? String(x.updatedAt) : undefined,
    tags: Array.isArray(x.tags) ? x.tags.map((t: any) => String(t)).filter(Boolean).slice(0, 20) : undefined,
    minAppVersion: x.minAppVersion ? String(x.minAppVersion) : undefined,
  };
}

function normalizePreset(x: any): CustomAppModule | null {
  if (!x || typeof x !== 'object') return null;
  const id = String(x.id || '').trim();
  const label = String(x.label || '').trim();
  if (!id || !label) return null;
  // 兼容旧字段：prompt -> instruction（将提示词“固化”到预设内）
  if (typeof x.instruction !== 'string' && typeof x.prompt === 'string') {
    x.instruction = x.prompt;
  }
  return x as CustomAppModule;
}

export default function StoreSection(props: {
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  /** 安装/回滚后同步更新 App 内存态（让「能力」立即刷新） */
  onPresetsApplied?: (presets: CustomAppModule[]) => void;
}) {
  const onLog = props.onLog;
  const onPresetsApplied = props.onPresetsApplied;
  const [catalogUrl, setCatalogUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_CATALOG_URL) || DEFAULT_CATALOG_URL;
    } catch {
      return DEFAULT_CATALOG_URL;
    }
  });
  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState<StoreCatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [installed, setInstalled] = useState<InstalledStorePack[]>(() => loadInstalledPacks());
  const installedMap = useMemo(() => new Map(installed.map((p) => [p.id, p])), [installed]);

  const [presetsCount, setPresetsCount] = useState<number>(() => loadCapabilityPresets().length);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      localStorage.setItem(STORAGE_KEY_CATALOG_URL, catalogUrl);
    } catch {}
    try {
      const raw = await fetchJson<any[]>(catalogUrl);
      const list = (Array.isArray(raw) ? raw : [])
        .map(normalizeCatalogItem)
        .filter(Boolean) as StoreCatalogItem[];
      setCatalog(list);
      onLog?.('info', `商店目录加载成功（${list.length} 项）`, undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onLog?.('error', '商店目录加载失败', msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const installOrUpdate = async (item: StoreCatalogItem) => {
    setLoading(true);
    setError(null);
    try {
      onLog?.('info', `开始下载：${item.name} v${item.version}`, item.url);
      // 支持 catalog 内使用相对路径（相对 catalogUrl）
      const packUrl = (() => {
        try {
          return new URL(item.url, catalogUrl).toString();
        } catch {
          return item.url;
        }
      })();
      const raw = await fetchJson<any>(packUrl);
      if (!Array.isArray(raw)) throw new Error('能力包 JSON 必须为数组（CustomAppModule[]）');
      const packPresets = raw.map(normalizePreset).filter(Boolean) as CustomAppModule[];
      if (packPresets.length === 0) throw new Error('能力包为空或格式不正确');

      // 1) 记录该包的“版本快照”（用于历史版本切换）
      const snapshot: StorePackVersionSnapshot = {
        version: item.version,
        installedAt: Date.now(),
        sha256: item.sha256,
        presets: packPresets,
      };
      pushPackHistory(item.id, snapshot);

      // 2) 合并覆盖（同 id 覆盖）
      const merged = mergeCapabilityPresets(loadCapabilityPresets(), packPresets);
      saveCapabilityPresets(merged);
      setPresetsCount(merged.length);
      onPresetsApplied?.(merged);

      // 3) 更新已安装信息
      const nextInstalled: InstalledStorePack[] = [
        {
          id: item.id,
          type: 'capability_presets',
          name: item.name,
          version: item.version,
          url: packUrl,
          sha256: item.sha256,
          installedAt: Date.now(),
        },
        ...installed.filter((p) => p.id !== item.id),
      ];
      setInstalled(nextInstalled);
      saveInstalledPacks(nextInstalled);

      onLog?.('info', `安装/更新完成：${item.name} v${item.version}`, `写入能力 ${packPresets.length} 条`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onLog?.('error', `安装失败：${item.name}`, msg);
    } finally {
      setLoading(false);
    }
  };

  const rollbackTo = (packId: string, v: StorePackVersionSnapshot) => {
    try {
      const merged = mergeCapabilityPresets(loadCapabilityPresets(), v.presets);
      saveCapabilityPresets(merged);
      setPresetsCount(merged.length);
      onPresetsApplied?.(merged);
      onLog?.('info', `已回滚/切换到历史版本：${packId} v${v.version}`, `覆盖能力 ${v.presets.length} 条`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onLog?.('error', '回滚失败', msg);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in max-w-4xl">
      <header className="shrink-0 h-14 flex items-center px-4 lg:px-6 border-b border-white/10 bg-black/20 rounded-2xl">
        <h1 className="text-sm font-black uppercase tracking-widest text-white/90">商店</h1>
        <span className="ml-3 text-[10px] text-gray-500">远程能力包（配置）· 可安装/更新/回滚</span>
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9px] font-black uppercase text-gray-500">Catalog URL</span>
          <input
            value={catalogUrl}
            onChange={(e) => setCatalogUrl(e.target.value)}
            placeholder="https://xxx.github.io/yyy/catalog.json"
            className="flex-1 min-w-[280px] px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-[11px] text-white placeholder-gray-600 focus:border-blue-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[10px] font-black uppercase"
          >
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>
        {error && <div className="text-[10px] text-red-400 break-all">{error}</div>}
        <p className="text-[9px] text-gray-600">
          说明：你把 <code className="text-gray-400">catalog.json</code> 和能力包 JSON 放到 GitHub / CDN，上线后这里就能远程拉取并更新（安装后会合并到「能力」）。
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-black uppercase text-blue-400">能力包</div>
          <div className="text-[9px] text-gray-500">当前能力总数：{presetsCount}</div>
        </div>

        {catalog.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/40 p-8 text-center text-gray-500 text-[10px]">
            暂无条目（检查 catalog URL 是否可访问 / 是否为 JSON 数组）
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {catalog.map((item) => {
              const ins = installedMap.get(item.id);
              const hasUpdate = ins && ins.version !== item.version;
              const history = loadPackHistory(item.id);
              return (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-black text-white/90">{item.name}</div>
                      <div className="text-[9px] text-gray-500 break-all">
                        <span className="mr-2">id: {item.id}</span>
                        <span>v{item.version}</span>
                        {item.updatedAt && <span className="ml-2">· {item.updatedAt}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void installOrUpdate(item)}
                      disabled={loading}
                      className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase ${
                        !ins
                          ? 'bg-blue-600 hover:bg-blue-500'
                          : hasUpdate
                            ? 'bg-amber-600/80 hover:bg-amber-500'
                            : 'bg-white/10 hover:bg-white/20'
                      }`}
                      title={item.url}
                    >
                      {!ins ? '安装' : hasUpdate ? '更新' : '重新安装'}
                    </button>
                  </div>
                  {item.desc && <div className="text-[9px] text-gray-500">{item.desc}</div>}
                  {ins && (
                    <div className="text-[9px] text-gray-600">
                      已安装：v{ins.version} · {new Date(ins.installedAt).toLocaleString()}
                    </div>
                  )}

                  {history.length > 0 && (
                    <div className="pt-2 border-t border-white/10">
                      <div className="text-[8px] font-black uppercase text-gray-500 mb-1">历史版本（本机）</div>
                      <div className="flex flex-wrap gap-2">
                        {history.slice(0, 6).map((h) => (
                          <button
                            key={`${item.id}-${h.version}-${h.installedAt}`}
                            type="button"
                            onClick={() => rollbackTo(item.id, h)}
                            className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[8px] font-black uppercase"
                            title={new Date(h.installedAt).toLocaleString()}
                          >
                            v{h.version}
                          </button>
                        ))}
                        {history.length > 6 && <span className="text-[8px] text-gray-600 self-center">…共 {history.length} 条</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

