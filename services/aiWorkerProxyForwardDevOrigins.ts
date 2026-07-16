/**
 * Local dev: browsers may fail CORS when calling the public AI Worker Proxy
 * directly, so Vite forwards `/__ac-ai-worker-forward/{i}/...` to origins[i].
 */
export const DEFAULT_AI_WORKER_PROXY_ORIGIN = "https://assetcutter-ai-worker-proxy.onrender.com";

function pushOrigin(out: string[], raw: string | undefined): void {
  if (typeof raw !== "string") return;
  const t = raw.trim();
  if (!t) return;
  const low = t.toLowerCase();
  if (low === "1" || low === "true" || low === "same-origin") return;
  let u: URL;
  try {
    u = /^https?:\/\//i.test(t) ? new URL(t) : new URL(`https://${t}`);
  } catch {
    return;
  }
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return;
  const origin = u.origin;
  if (!out.includes(origin)) out.push(origin);
}

export function collectRemoteAiWorkerProxyOriginsFromEnv(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  pushOrigin(out, env.VITE_AI_WORKER_PROXY_API);
  pushOrigin(out, env.VITE_AI_WORKER_PROXY_API_VERTEX);
  pushOrigin(out, env.VITE_VERTEX_FALLBACK_AI_WORKER_PROXY_API);
  pushOrigin(out, DEFAULT_AI_WORKER_PROXY_ORIGIN);
  return out;
}

export function aiWorkerProxyForwardOriginIndex(baseResolved: string, origins: readonly string[]): number {
  try {
    const t = baseResolved.trim();
    const u = /^https?:\/\//i.test(t) ? new URL(t) : new URL(`https://${t}`);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return -1;
    return origins.indexOf(u.origin);
  } catch {
    return -1;
  }
}
