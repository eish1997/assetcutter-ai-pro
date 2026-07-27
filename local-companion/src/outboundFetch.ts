/**
 * Outbound HTTP for companion (import-url etc.).
 * Honors TRIPO_PROXY / HTTPS_PROXY / HTTP_PROXY — same convention as auth-api.
 */

import { fetch as undiciFetch, ProxyAgent, type RequestInit as UndiciRequestInit } from 'undici';

function outboundProxyUrl(): string {
  return String(
    process.env.TRIPO_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''
  ).trim();
}

let cachedAgent: ProxyAgent | null | undefined;

function proxyAgent(): ProxyAgent | null {
  if (cachedAgent !== undefined) return cachedAgent;
  const proxy = outboundProxyUrl();
  cachedAgent = proxy ? new ProxyAgent(proxy) : null;
  return cachedAgent;
}

/** Reset cached agent (tests). */
export function resetOutboundFetchProxyForTests(): void {
  cachedAgent = undefined;
}

export async function outboundFetch(
  url: string,
  init?: UndiciRequestInit
): Promise<Response> {
  const agent = proxyAgent();
  if (!agent) {
    return fetch(url, init as RequestInit);
  }
  return undiciFetch(url, { ...init, dispatcher: agent }) as unknown as Promise<Response>;
}
