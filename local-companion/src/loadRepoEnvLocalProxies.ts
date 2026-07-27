/**
 * Dev: load TRIPO_PROXY / HTTPS_PROXY / HTTP_PROXY from repo-root `.env.local`
 * when the process was started without `--env-file` or desktop-shell injection
 * (e.g. bare `npm run local-companion:dev` under concurrently).
 *
 * Never overrides keys already set in the process environment.
 *
 * Packaged CJS bundle (esbuild format:cjs under Electron RUN_AS_NODE) may not
 * have a usable `import.meta.url`; skip auto path resolution in that case —
 * install shells inject proxy env separately and have no repo `.env.local`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROXY_KEYS = ['TRIPO_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY'] as const;

function repoRootFromHere(): string | null {
  try {
    const metaUrl: unknown = import.meta.url;
    if (typeof metaUrl !== 'string' || !metaUrl) return null;
    const here = path.dirname(fileURLToPath(metaUrl));
    // local-companion/src → repo root
    return path.resolve(here, '..', '..');
  } catch {
    return null;
  }
}

function stripQuotes(val: string): string {
  const v = String(val || '').trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * @returns keys that were newly applied from `.env.local`
 */
export function loadRepoEnvLocalProxies(envLocalPath?: string): string[] {
  let filePath = envLocalPath || '';
  if (!filePath) {
    const root = repoRootFromHere();
    if (!root) return [];
    filePath = path.join(root, '.env.local');
  }
  if (!fs.existsSync(filePath)) return [];
  let text = '';
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const applied: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = String(line || '').trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!(PROXY_KEYS as readonly string[]).includes(key)) continue;
    if (String(process.env[key] || '').trim()) continue;
    const val = stripQuotes(t.slice(eq + 1));
    if (!val) continue;
    process.env[key] = val;
    applied.push(key);
  }
  return applied;
}

export function outboundProxyConfigured(): boolean {
  return Boolean(
    String(
      process.env.TRIPO_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''
    ).trim()
  );
}
