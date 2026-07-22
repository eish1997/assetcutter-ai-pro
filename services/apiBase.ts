function trimSlash(input: string) {
  return input.replace(/\/+$/, '');
}

/** 与 `.env.production` / render.yaml assetcutter-web 一致；Vercel 面板误设空字符串时会覆盖 env 文件 */
export const DEFAULT_PRODUCTION_AUTH_API_BASE = 'https://assetcutter-auth-api.onrender.com';

/**
 * Vercel 静态站（含自定义域）经 vercel.json 将 `/api/*` 反代到 auth-api，与本地 Vite 同源反代等效。
 */
export function staticHostUsesSameOriginApiRelay(): boolean {
  try {
    if (!import.meta.env.PROD || typeof window === 'undefined') return false;
    const h = window.location.hostname.toLowerCase();
    return h.endsWith('.vercel.app') || h === 'app.adrazzo.com';
  } catch {
    return false;
  }
}

/** 构建期/运行时 auth 根：显式 env 优先；生产构建无 env 时回退默认 Render auth-api */
export function resolvedAuthApiBaseUrl(): string {
  const fromEnv = String(import.meta.env?.VITE_AUTH_API_BASE_URL || '').trim();
  if (fromEnv.toLowerCase() === 'same-origin') return '';
  try {
    /** 本地 dev：走 Vite 同源 /api 反代到 VITE_AUTH_API_BASE_URL，避免浏览器跨域 CORS */
    if (import.meta.env.DEV && !import.meta.env.PROD && fromEnv) return '';
    /** Vercel + vercel.json：走同源 /api 反代 */
    if (staticHostUsesSameOriginApiRelay()) return '';
  } catch {
    /* ignore */
  }
  if (fromEnv) return trimSlash(fromEnv);
  try {
    if (import.meta.env.PROD) return DEFAULT_PRODUCTION_AUTH_API_BASE;
  } catch {
    /* ignore */
  }
  return '';
}

/** dev 且配置了 VITE_AUTH_API_BASE_URL（经 Vite 反代云端 auth） */
export function devUsesRemoteAuthViaViteProxy(): boolean {
  try {
    return (
      import.meta.env.DEV &&
      !import.meta.env.PROD &&
      Boolean(String(import.meta.env?.VITE_AUTH_API_BASE_URL || '').trim())
    );
  } catch {
    return false;
  }
}

/** 生图/积分可走 auth 中继（绝对 URL 或同源 /api 反代） */
export function authApiRelayConfigured(): boolean {
  return (
    devUsesRemoteAuthViaViteProxy() ||
    Boolean(resolvedAuthApiBaseUrl()) ||
    staticHostUsesSameOriginApiRelay()
  );
}

export function apiUrl(path: string) {
  const base = resolvedAuthApiBaseUrl();
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function authApiDirectUrl(path: string): string {
  const fromEnv = String(import.meta.env?.VITE_AUTH_API_BASE_URL || '').trim();
  const base =
    fromEnv && fromEnv.toLowerCase() !== 'same-origin' && /^https?:\/\//i.test(fromEnv)
      ? trimSlash(fromEnv)
      : DEFAULT_PRODUCTION_AUTH_API_BASE;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * 工作区 R2 中间层（与 auth 同源时会话 Cookie 才能带上）。
 * 未设 `VITE_R2_API_BASE_URL` 时回退到 `VITE_AUTH_API_BASE_URL`；皆空则用同源 `/api/r2`（本地 Vite 代理到 auth）。
 */
export function r2ApiUrl(subpath: string): string {
  const r2 = String(import.meta.env?.VITE_R2_API_BASE_URL || '').trim();
  const auth = String(import.meta.env?.VITE_AUTH_API_BASE_URL || '').trim();
  const origin = trimSlash(r2 || auth);
  const s = subpath.startsWith('/') ? subpath : `/${subpath}`;
  const full = `/api/r2${s}`;
  if (!origin) return full;
  return `${origin}${full}`;
}

