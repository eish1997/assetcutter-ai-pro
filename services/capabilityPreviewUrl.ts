import { r2ApiUrl } from './apiBase';
import { getCapabilityStoreCatalogSources } from './settingsStore';
import type { CustomAppModule } from '../types';

/**
 * 将「站内形态」的 /api/r2/...（可含 query/hash）转为浏览器实际请求的 URL。
 * 构建时若配置了 VITE_AUTH_API_BASE_URL / VITE_R2_API_BASE_URL，且 API 与当前页不同源，则返回该源的绝对地址；
 * 否则保持相对路径（由 Vite 代理或同源网关处理）。
 * 解决：静态前端（Vercel/Render static）把 /api/* 回退成 index.html 时，img 收到 HTML 解码失败却无任何 JS 报错。
 */
function mapSiteR2PathToFetchUrl(sitePath: string): string {
  const raw = String(sitePath || '').trim();
  if (!raw.startsWith('/api/r2')) return raw;
  try {
    const ref = new URL(raw, 'http://r2preview.invalid');
    const sub = ref.pathname.slice('/api/r2'.length);
    const suffix = sub.startsWith('/') ? sub : `/${sub || ''}`;
    const built = r2ApiUrl(suffix);
    if (/^https?:\/\//i.test(built)) {
      const b = new URL(built);
      return `${b.origin}${b.pathname}${ref.search}${ref.hash}`;
    }
    return `${ref.pathname}${ref.search}${ref.hash}`;
  } catch {
    return raw;
  }
}

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
 * - `./` 等相对路径：相对能力商店 catalog 源解析；否则回退到 `/api/r2/capability-store/...` 再走 mapSiteR2PathToFetchUrl
 * - 以 `/api/r2/` 开头的站内 path：经 mapSiteR2PathToFetchUrl（生产静态站 + 已配 VITE_AUTH_API_BASE_URL 时变为 API 绝对地址）
 * - 绝对 URL 且路径含 `/api/r2/`：优先 mapSiteR2PathToFetchUrl；若仍为相对且与当前页不同源，再回退为当前 origin + path（本地不同端口等）
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
      const u = new URL(t);
      if (/\/api\/r2\//i.test(u.pathname || '')) {
        const sitePath = `${u.pathname}${u.search}${u.hash}`;
        const mapped = mapSiteR2PathToFetchUrl(sitePath);
        if (/^https?:\/\//i.test(mapped)) return mapped;
        if (typeof window !== 'undefined' && u.origin !== window.location.origin) {
          return `${window.location.origin}${u.pathname}${u.search}${u.hash}`;
        }
      }
    } catch {
      // ignore
    }
    return t;
  }
  if (t.startsWith('data:')) return t;
  if (t.startsWith('/')) {
    if (/\/api\/r2\//i.test(t)) return mapSiteR2PathToFetchUrl(t);
    return t;
  }
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
  return mapSiteR2PathToFetchUrl(`/api/r2/capability-store/${normalized}`);
}

/** 能力预设卡片预览：优先主预览缩略图，便于工作流节点资产卡展示 */
export function pickCapabilityPresetPreview(p: CustomAppModule | undefined | null): string | undefined {
  if (!p) return undefined;
  const v =
    p.previewImage ||
    p.previewGeneratedThumbImage ||
    p.previewOriginalThumbImage ||
    p.previewGeneratedImage ||
    p.previewOriginalImage;
  return v?.trim() ? v.trim() : undefined;
}

/** 加载失败时依次尝试的候选 URL（当前页同源 path 作为兜底） */
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
    if (!/\/api\/r2\//i.test(u.pathname)) return out;
    push(`${base}${u.pathname}${u.search}${u.hash}`);
  } catch {
    /* ignore */
  }
  return out;
}
