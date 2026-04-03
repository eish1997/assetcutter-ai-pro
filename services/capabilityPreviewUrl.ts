import { getCapabilityStoreCatalogSources } from './settingsStore';

/**
 * 将能力预设中的预览字段解析为浏览器可请求的 URL。
 * - 相对路径 / `./`：相对能力商店 catalog 源或回退到同源 `/api/r2/capability-store/...`
 * - 绝对 URL 且路径为 `/api/r2/capability-store/...` 但 host 非当前站点：改写为当前 origin（跨设备规则）
 */
export function resolveCapabilityPreviewSrc(
  v: string | undefined | null,
  catalogSources: string[] = getCapabilityStoreCatalogSources()
): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (!t) return undefined;
  if (/^https?:\/\//i.test(t)) {
    try {
      if (typeof window !== 'undefined') {
        const u = new URL(t);
        const currentHost = window.location.hostname.toLowerCase();
        const host = u.hostname.toLowerCase();
        const isCapabilityStoreApiPath = /\/api\/r2\/capability-store\//i.test(u.pathname || '');
        if (isCapabilityStoreApiPath && host !== currentHost) {
          return `${window.location.origin}${u.pathname}${u.search}${u.hash}`;
        }
      }
    } catch {
      // ignore
    }
    return t;
  }
  if (t.startsWith('data:') || t.startsWith('/')) return t;
  const rel = t.startsWith('./') ? t.slice(2) : t.replace(/^\/+/, '');
  for (const src of catalogSources) {
    if (!/^https?:\/\//i.test(src)) continue;
    try {
      return new URL(rel, src).toString();
    } catch {
      // try next
    }
  }
  const normalized = rel.replace(/^public\/capability-store\/?/i, '');
  return `/api/r2/capability-store/${normalized}`;
}

/** 加载失败时依次尝试的候选 URL（同源优先） */
export function capabilityPreviewAlternateUrls(src: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const x = s.trim();
    if (x && !out.includes(x)) out.push(x);
  };
  push(src);
  try {
    if (typeof window === 'undefined') return out;
    const base = window.location.origin;
    const u = new URL(src, `${base}/`);
    if (!/\/api\/r2\/capability-store\//i.test(u.pathname)) return out;
    push(`${base}${u.pathname}${u.search}${u.hash}`);
  } catch {
    /* ignore */
  }
  return out;
}
