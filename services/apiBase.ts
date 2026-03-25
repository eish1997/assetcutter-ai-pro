function trimSlash(input: string) {
  return input.replace(/\/+$/, '');
}

export function apiUrl(path: string) {
  const fromEnv = String(import.meta.env?.VITE_AUTH_API_BASE_URL || '').trim();
  if (!fromEnv) return path;
  const base = trimSlash(fromEnv);
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

