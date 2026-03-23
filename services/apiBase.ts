function trimSlash(input: string) {
  return input.replace(/\/+$/, '');
}

export function apiUrl(path: string) {
  const fromEnv = String(import.meta.env?.VITE_AUTH_API_BASE_URL || '').trim();
  if (!fromEnv) return path;
  const base = trimSlash(fromEnv);
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

