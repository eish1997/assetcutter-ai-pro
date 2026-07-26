/**
 * Fetch a remote media URL via auth-api (session + outbound proxy).
 * Used when browser CORS and companion import-url both cannot pull bytes.
 */

import { apiUrl } from './apiBase';

export async function fetchMediaUrlViaAuthApi(url: string): Promise<Blob> {
  const source = String(url || '').trim();
  if (!source) throw new Error('Missing media url');
  if (!/^https?:\/\//i.test(source)) throw new Error('Only http(s) media urls are supported');

  const endpoint = apiUrl('/api/media/fetch-url');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ url: source }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`auth_media_fetch_failed (${response.status}): ${text || 'unknown error'}`);
  }
  return await response.blob();
}
