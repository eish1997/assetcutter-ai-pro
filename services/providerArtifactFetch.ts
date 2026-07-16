import { apiUrl } from './apiBase';

export type ProviderArtifactFetchOptions = {
  providerId: string;
  url: string;
};

function normalizeProviderId(providerId: string): string {
  return String(providerId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function fetchProviderArtifactBlob(options: ProviderArtifactFetchOptions): Promise<Blob> {
  const providerId = normalizeProviderId(options.providerId);
  const url = String(options.url || '').trim();
  if (!providerId) throw new Error('Missing provider id');
  if (!url) throw new Error('Missing provider artifact URL');
  const endpoint = apiUrl(`/api/ai/provider-artifacts/${encodeURIComponent(providerId)}/fetch-file`);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Provider artifact fetch failed (${response.status}): ${text || 'unknown error'}`);
  }
  return await response.blob();
}

export const __providerArtifactFetchTest = {
  normalizeProviderId,
};
