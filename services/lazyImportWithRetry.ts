/**
 * Production-safe dynamic import: retry once, then hard-reload once when a
 * hashed Vite chunk 404s after deploy (SPA fallback / stale tab).
 */
import { readSessionString, removeSessionKey, writeSessionString } from './clientPersist';

const RELOAD_FLAG = 'ac:chunk-reload';

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\d]+ failed/i.test(
    msg
  );
}

function reloadOnceForStaleChunk(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (readSessionString(RELOAD_FLAG) === '1') return false;
    writeSessionString(RELOAD_FLAG, '1');
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export function clearChunkReloadFlag(): void {
  try {
    removeSessionKey(RELOAD_FLAG);
  } catch {
    /* ignore */
  }
}

/** Call once on app boot so a successful load clears the one-shot reload latch. */
export function armChunkReloadRecovery(): void {
  clearChunkReloadFlag();
}

export async function importWithChunkRetry<T>(
  loader: () => Promise<T>,
  opts?: { retries?: number }
): Promise<T> {
  const retries = opts?.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const mod = await loader();
      clearChunkReloadFlag();
      return mod;
    } catch (err) {
      lastErr = err;
      if (!isChunkLoadError(err) || attempt >= retries) break;
      await new Promise((r) => setTimeout(r, 200 + attempt * 200));
    }
  }
  if (isChunkLoadError(lastErr) && reloadOnceForStaleChunk()) {
    // Page is reloading; keep promise pending so React.lazy does not flash error UI.
    return new Promise<T>(() => {});
  }
  throw lastErr;
}
