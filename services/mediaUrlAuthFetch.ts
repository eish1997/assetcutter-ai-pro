/**
 * Fetch a remote media URL via auth-api (session + outbound proxy).
 * Used when browser CORS and companion import-url both cannot pull bytes.
 */

import { apiUrl } from './apiBase';

function csrfHeader(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const raw of cookies) {
    const [k, ...rest] = raw.trim().split('=');
    if (k === 'ac_csrf') {
      const token = decodeURIComponent(rest.join('=') || '');
      return token ? { 'X-CSRF-Token': token } : {};
    }
  }
  return {};
}

export async function fetchMediaUrlViaAuthApi(url: string): Promise<Blob> {
  const source = String(url || '').trim();
  if (!source) throw new Error('Missing media url');
  if (!/^https?:\/\//i.test(source)) throw new Error('Only http(s) media urls are supported');

  const endpoint = apiUrl('/api/media/fetch-url');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeader(),
    },
    credentials: 'include',
    body: JSON.stringify({ url: source }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let detail = text.trim();
    try {
      const parsed = detail ? (JSON.parse(detail) as { error?: unknown; hint?: unknown }) : null;
      const err = parsed && typeof parsed.error === 'string' ? parsed.error : '';
      const hint = parsed && typeof parsed.hint === 'string' ? parsed.hint : '';
      detail = [err, hint].filter(Boolean).join('；') || detail;
    } catch {
      /* keep raw text */
    }
    throw new Error(`auth_media_fetch_failed (${response.status}): ${detail || 'unknown error'}`);
  }
  return await response.blob();
}
