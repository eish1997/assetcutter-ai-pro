import { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomAppModule, StoreCatalogItem } from '../types';
import { BUILTIN_IMAGE_PROCESS_IDS, loadCapabilityPresets, mergeCapabilityPresets, saveCapabilityPresets } from './capabilityPresetStore';
import { getCapabilityStoreCatalogSources } from './settingsStore';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`请求失败：${res.status} ${res.statusText}`);
  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();
  const looksLikeHtml = /^\s*</.test(text);
  if (!contentType.includes('application/json') || looksLikeHtml) {
    throw new Error(`接口返回非 JSON（疑似 HTML 回退页）：${url}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`接口 JSON 解析失败：${url}`);
  }
}

function resolvePackUrl(itemUrl: string, baseUrl: string): string {
  const raw = String(itemUrl || '').trim();
  const base = String(baseUrl || '').trim();
  if (!raw) return raw;
  try {
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^https?:\/\//i.test(base)) return new URL(raw, base).toString();
    // base 为同源相对路径（如 /api/r2/capability-store/catalog）时，使用当前 origin 兜底
    if (typeof window !== 'undefined' && base.startsWith('/')) {
      return new URL(raw, `${window.location.origin}${base}`).toString();
    }
    return new URL(raw, window.location.href).toString();
  } catch {
    return raw;
  }
}

function normalizeCatalogItem(x: unknown): StoreCatalogItem | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = String(o.id || '').trim();
  const type = String(o.type || '').trim();
  const name = String(o.name || '').trim();
  const version = String(o.version || '').trim();
  const url = String(o.url || '').trim();
  if (!id || !name || !version || !url) return null;
  if (type !== 'capability_presets') return null;
  return {
    id,
    type: 'capability_presets',
    name,
    version,
    url,
    desc: o.desc ? String(o.desc) : undefined,
    previewUrl: o.previewUrl ? String(o.previewUrl) : undefined,
    sha256: o.sha256 ? String(o.sha256) : undefined,
    updatedAt: o.updatedAt ? String(o.updatedAt) : undefined,
    tags: Array.isArray(o.tags) ? (o.tags as unknown[]).map((t) => String(t)).filter(Boolean).slice(0, 20) : undefined,
    minAppVersion: o.minAppVersion ? String(o.minAppVersion) : undefined,
  };
}

function normalizePreset(x: unknown): CustomAppModule | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = String(o.id || '').trim();
  const label = String(o.label || '').trim();
  if (!id || !label) return null;
  if (typeof o.instruction !== 'string' && typeof o.prompt === 'string') (o as Record<string, string>).instruction = o.prompt as string;
  if (o.previewImage != null && typeof o.previewImage !== 'string') delete (o as Record<string, unknown>).previewImage;
  return o as unknown as CustomAppModule;
}

export type UseStoreCatalogOptions = {
  onPresetsApplied?: (presets: CustomAppModule[]) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
};

export type RemotePresetItem = { preset: CustomAppModule; pack: StoreCatalogItem };

export function useStoreCatalog(options: UseStoreCatalogOptions = {}) {
  const { onPresetsApplied, onLog } = options;
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState<StoreCatalogItem[]>([]);
  const [packPresetsMap, setPackPresetsMap] = useState<Record<string, CustomAppModule[]>>({});
  const [packContentsLoading, setPackContentsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingAll, setInstallingAll] = useState(false);
  const packBaseUrlMapRef = useRef<Record<string, string>>({});

  /** 远程各包展开为「能力」列表，用于按能力展示卡片 */
  const remotePresetItems = useMemo(
    () =>
      catalog.flatMap((pack) =>
        (packPresetsMap[pack.id] || [])
          .filter((preset) => !BUILTIN_IMAGE_PROCESS_IDS.includes(preset.id as (typeof BUILTIN_IMAGE_PROCESS_IDS)[number]))
          .map((preset) => ({ preset, pack } as RemotePresetItem))
      ),
    [catalog, packPresetsMap]
  );

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const sources = getCapabilityStoreCatalogSources();
      if (sources.length === 0) {
        setCatalog([]);
        packBaseUrlMapRef.current = {};
        onLog?.('warn', '未配置能力商店源地址', undefined);
        return;
      }
      const merged: StoreCatalogItem[] = [];
      const baseMap: Record<string, string> = {};
      const seen = new Set<string>();
      let filteredCount = 0;
      for (const base of sources) {
        const toFetch = base.includes('?') ? `${base}&t=${Date.now()}` : `${base}?t=${Date.now()}`;
        try {
          const raw = await fetchJson<unknown>(toFetch);
          const arr = Array.isArray(raw) ? raw : [];
          const list = arr.map(normalizeCatalogItem).filter(Boolean) as StoreCatalogItem[];
          filteredCount += arr.length - list.length;
          for (const item of list) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            merged.push(item);
            baseMap[item.id] = base;
          }
        } catch (e) {
          onLog?.('warn', `商店源加载失败：${base}`, e instanceof Error ? e.message : String(e));
        }
      }
      packBaseUrlMapRef.current = baseMap;
      if (filteredCount > 0) {
        onLog?.('warn', `商店目录部分项被过滤（无效 ${filteredCount}）`, undefined);
      }
      setCatalog(merged);
      onLog?.('info', `商店目录加载成功（${merged.length} 项，来源 ${sources.length}）`, undefined);
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

  useEffect(() => {
    if (catalog.length === 0) {
      setPackPresetsMap({});
      return;
    }
    setPackContentsLoading(true);
    Promise.all(
      catalog.map(async (item) => {
        try {
          const baseUrl = packBaseUrlMapRef.current[item.id] || '';
          const packUrl = resolvePackUrl(item.url, baseUrl);
          const raw = await fetchJson<unknown>(packUrl);
          if (!Array.isArray(raw)) return { id: item.id, presets: [] };
          const catalogBase = packBaseUrlMapRef.current[item.id] || '';
          const presets = raw
            .map(normalizePreset)
            .filter(Boolean)
            .map((pr) => {
              let p = pr as CustomAppModule;
              if ((!p.previewImage || !String(p.previewImage).trim()) && item.previewUrl && catalogBase) {
                p = { ...p, previewImage: resolvePackUrl(String(item.previewUrl), catalogBase) };
              }
              const resolvePreviewField = (value: unknown): string | undefined => {
                if (typeof value !== 'string' || !value.trim()) return undefined;
                const t = value.trim();
                if (/^https?:\/\//i.test(t) || t.startsWith('data:')) return t;
                if (!catalogBase) return t;
                return resolvePackUrl(t, catalogBase);
              };
              const resolvedPreviewImage = resolvePreviewField(p.previewImage);
              const resolvedOriginal = resolvePreviewField((p as CustomAppModule).previewOriginalImage);
              const resolvedGenerated = resolvePreviewField((p as CustomAppModule).previewGeneratedImage);
              const resolvedOriginalThumb = resolvePreviewField((p as CustomAppModule).previewOriginalThumbImage);
              const resolvedGeneratedThumb = resolvePreviewField((p as CustomAppModule).previewGeneratedThumbImage);
              const inferredOriginal =
                !resolvedOriginal && typeof resolvedPreviewImage === 'string' && /-gen\.[a-z0-9]+$/i.test(resolvedPreviewImage)
                  ? resolvedPreviewImage.replace(/-gen(\.[a-z0-9]+)$/i, '-orig$1')
                  : resolvedOriginal;
              const inferredOriginalThumb =
                !resolvedOriginalThumb && typeof resolvedGeneratedThumb === 'string' && /-gen-sm\.[a-z0-9]+$/i.test(resolvedGeneratedThumb)
                  ? resolvedGeneratedThumb.replace(/-gen-sm(\.[a-z0-9]+)$/i, '-orig-sm$1')
                  : resolvedOriginalThumb;
              return {
                ...p,
                previewImage: resolvedPreviewImage,
                previewOriginalImage: inferredOriginal,
                previewGeneratedImage: resolvedGenerated ?? resolvedPreviewImage,
                previewOriginalThumbImage: inferredOriginalThumb,
                previewGeneratedThumbImage: resolvedGeneratedThumb,
              };
            }) as CustomAppModule[];
          return { id: item.id, presets };
        } catch (e) {
          onLogRef.current?.('warn', `拉取能力包失败：${item.name}`, e instanceof Error ? e.message : String(e));
          return { id: item.id, presets: [] };
        }
      })
    ).then((results) => {
      const next: Record<string, CustomAppModule[]> = {};
      for (const { id, presets } of results) next[id] = presets;
      setPackPresetsMap(next);
      setPackContentsLoading(false);
    });
  }, [catalog]);

  /** 安装单个能力到当前列表（以能力为单位，不按包） */
  const installSinglePreset = (preset: CustomAppModule) => {
    if (BUILTIN_IMAGE_PROCESS_IDS.includes(preset.id as (typeof BUILTIN_IMAGE_PROCESS_IDS)[number])) return;
    setError(null);
    const merged = mergeCapabilityPresets(loadCapabilityPresets(), [preset]);
    saveCapabilityPresets(merged);
    onPresetsApplied?.(merged);
    onLog?.('info', `已添加能力：${preset.label}`, undefined);
  };

  /** 批量添加多个能力到当前列表（一键安装全部未安装的能力） */
  const installPresets = (presets: CustomAppModule[]) => {
    const filtered = presets.filter(
      (p) => !BUILTIN_IMAGE_PROCESS_IDS.includes(p.id as (typeof BUILTIN_IMAGE_PROCESS_IDS)[number])
    );
    if (filtered.length === 0) return;
    setInstallingAll(true);
    setError(null);
    const merged = mergeCapabilityPresets(loadCapabilityPresets(), filtered);
    saveCapabilityPresets(merged);
    onPresetsApplied?.(merged);
    onLog?.('info', `已添加 ${filtered.length} 个能力`, undefined);
    setInstallingAll(false);
  };

  return {
    catalog,
    loading,
    error,
    refresh,
    installSinglePreset,
    installPresets,
    installingAll,
    packContentsLoading,
    remotePresetItems,
  };
}
