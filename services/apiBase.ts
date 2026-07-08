function trimSlash(input: string) {
  return input.replace(/\/+$/, '');
}

/** 与 `.env.production` / render.yaml assetcutter-web 一致；Vercel 面板误设空字符串时会覆盖 env 文件 */
export const DEFAULT_PRODUCTION_AUTH_API_BASE = 'https://assetcutter-auth-api.onrender.com';

/** 构建期/运行时 auth 根：显式 env 优先；生产构建无 env 时回退默认 Render auth-api */
export function resolvedAuthApiBaseUrl(): string {
  const fromEnv = String(import.meta.env?.VITE_AUTH_API_BASE_URL || '').trim();
  if (fromEnv) return trimSlash(fromEnv);
  try {
    if (import.meta.env.PROD) return DEFAULT_PRODUCTION_AUTH_API_BASE;
  } catch {
    /* ignore */
  }
  return '';
}

export function apiUrl(path: string) {
  const base = resolvedAuthApiBaseUrl();
  if (!base) return path;
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

