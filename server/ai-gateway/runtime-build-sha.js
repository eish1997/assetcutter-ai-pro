/**
 * C16 — runtime buildSha for auth + cached proxy health.
 */

import { fetch as undiciFetch } from 'undici';
import { resolveBuildSha } from '../../shared/buildSha.js';

let proxyCache = { sha: null, at: 0, error: null };
let refreshTimer = null;

function proxyHealthUrl() {
  const base = String(
    process.env.AI_WORKER_PROXY_UPSTREAM_URL ||
      process.env.AI_WORKER_PROXY_API ||
      process.env.VITE_AI_WORKER_PROXY_API ||
      ''
  )
    .trim()
    .replace(/\/+$/, '');
  if (!base || base === 'same-origin') {
    const port = String(process.env.AI_WORKER_PROXY_PORT || '9002').trim() || '9002';
    return `http://127.0.0.1:${port}/healthz`;
  }
  if (!/^https?:\/\//i.test(base)) return '';
  return `${base}/healthz`;
}

export function getAuthBuildSha() {
  return resolveBuildSha();
}

export function getCachedProxyBuildSha() {
  const forced = String(process.env.AI_WORKER_PROXY_BUILD_SHA || '').trim();
  if (forced) return forced.slice(0, 40);
  return proxyCache.sha;
}

export function getRuntimeBuildShaSnapshot() {
  return {
    auth: getAuthBuildSha(),
    proxy: getCachedProxyBuildSha(),
    proxyCacheAgeMs: proxyCache.at ? Date.now() - proxyCache.at : null,
    proxyCacheError: proxyCache.error,
  };
}

export async function refreshProxyBuildShaCache(options = {}) {
  const url = proxyHealthUrl();
  if (!url) {
    proxyCache = { sha: null, at: Date.now(), error: 'proxy_health_url_missing' };
    return proxyCache;
  }
  const fetchImpl = options.fetchImpl || undiciFetch;
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(Number(options.timeoutMs || 2500)),
    });
    const body = await res.json().catch(() => ({}));
    const sha = String(body.buildSha || body.gitSha || '').trim().slice(0, 40) || null;
    proxyCache = {
      sha,
      at: Date.now(),
      error: res.ok ? null : `HTTP_${res.status}`,
    };
  } catch (err) {
    proxyCache = {
      sha: proxyCache.sha,
      at: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return proxyCache;
}

export function startProxyBuildShaCacheLoop(options = {}) {
  if (refreshTimer) return;
  const intervalMs = Math.max(15_000, Number(options.intervalMs || process.env.AI_GATEWAY_PROXY_BUILD_SHA_REFRESH_MS || 60_000));
  void refreshProxyBuildShaCache(options);
  refreshTimer = setInterval(() => {
    void refreshProxyBuildShaCache(options);
  }, intervalMs);
  if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
}
