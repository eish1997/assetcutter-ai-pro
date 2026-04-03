import { getCapabilityStoreCatalogSources } from './settingsStore';

/**
 * 持久化前：将站内 R2 API 的绝对 URL 压成「仅 path+query+hash」，避免把 localhost/固定域名写入 localStorage 与同步数据（跨设备规则）。
 * 已以 `/` 开头或非 http(s) 的相对形式则原样返回。
 */
export function normalizeCapabilityPreviewUrlForPersist(raw: string): string {
  const t = String(raw || '').trim();
  if (!t || t.startsWith('data:') || t.startsWith('/')) return t;
  try {
    const u = new URL(t);
    if (/\/api\/r2\//i.test(u.pathname)) {
      return `${u.pathname}${u.search}${u.hash}`;
    }
  } catch {
    /* keep */
  }
  return t;
}

/**
 * 将能力预设中的预览字段解析为浏览器可请求的 URL。
 * - 相对路径 / `./`：相对能力商店 catalog 源或回退到同源 `/api/r2/capability-store/...`
 * - 绝对 URL 且路径为 `/api/r2/capability-store/...` 但 **origin** 非当前页面：改写为当前 `location.origin` + path（跨设备；含不同端口）
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
        const isCapabilityStoreApiPath = /\/api\/r2\/capability-store\//i.test(u.pathname || '');
        // 用 origin 比较：避免 localhost:9100 与 localhost:5173 被误判为「同 host」而不改写
        if (isCapabilityStoreApiPath && u.origin !== window.location.origin) {
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
