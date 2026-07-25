/**
 * C5 — detect auth↔proxy topology mismatch (local auth + cloud proxy, etc.).
 * Used by Dev banner + aligns with `npm run env:profile:*`.
 */

export type AiEnvHostKind = 'empty' | 'local' | 'same-origin' | 'cloud' | 'remote';

export type AiEnvTopologyIssue = {
  code: 'local_auth_cloud_proxy' | 'cloud_auth_local_proxy';
  severity: 'warn';
  /** 勿当预发 */
  messageZh: string;
  authKind: AiEnvHostKind;
  proxyKind: AiEnvHostKind;
};

export type AiEnvTopologyResult = {
  ok: boolean;
  authKind: AiEnvHostKind;
  proxyKind: AiEnvHostKind;
  issue: AiEnvTopologyIssue | null;
};

export function hostKind(urlOrHost: string | undefined | null): AiEnvHostKind {
  const raw = String(urlOrHost || '').trim();
  if (!raw) return 'empty';
  if (raw.toLowerCase() === 'same-origin') return 'same-origin';
  let host = raw;
  try {
    if (raw.includes('://')) host = new URL(raw).hostname;
  } catch {
    /* keep raw */
  }
  const h = host.toLowerCase();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '[::1]' ||
    h.endsWith('.local')
  ) {
    return 'local';
  }
  if (h.includes('onrender.com') || h.includes('vercel.app') || h.includes('adrazzo.com')) {
    return 'cloud';
  }
  return 'remote';
}

function isLocalWorld(kind: AiEnvHostKind): boolean {
  return kind === 'local' || kind === 'same-origin' || kind === 'empty';
}

function isCloudWorld(kind: AiEnvHostKind): boolean {
  return kind === 'cloud' || kind === 'remote';
}

export type EvaluateAiEnvTopologyInput = {
  /** Raw VITE_AUTH_API_BASE_URL (empty = Vite same-origin relay to local auth in DEV) */
  authBaseUrl?: string;
  proxyApi?: string;
  /** When true and auth empty → treat as local auth world */
  assumeEmptyAuthIsLocal?: boolean;
};

/**
 * Pure topology check (also used by vitest).
 */
export function evaluateAiEnvTopology(input: EvaluateAiEnvTopologyInput = {}): AiEnvTopologyResult {
  const authRaw = String(input.authBaseUrl ?? '').trim();
  const proxyRaw = String(input.proxyApi ?? '').trim();
  let authKind = hostKind(authRaw);
  if (authKind === 'empty' && input.assumeEmptyAuthIsLocal !== false) {
    authKind = 'local';
  }
  const proxyKind = hostKind(proxyRaw);

  if (isLocalWorld(authKind) && isCloudWorld(proxyKind) && proxyRaw) {
    return {
      ok: false,
      authKind,
      proxyKind,
      issue: {
        code: 'local_auth_cloud_proxy',
        severity: 'warn',
        messageZh:
          '环境拓扑错配：本机 auth 登录世界 + 云端 AI Worker Proxy。Cookie/积分/公平桶可能不一致，勿当作预发验收。请对齐 VITE_AUTH_API_BASE_URL 与代理，或 npm run env:profile:prod-like。',
        authKind,
        proxyKind,
      },
    };
  }

  if (isCloudWorld(authKind) && (proxyKind === 'same-origin' || proxyKind === 'local')) {
    return {
      ok: false,
      authKind,
      proxyKind,
      issue: {
        code: 'cloud_auth_local_proxy',
        severity: 'warn',
        messageZh:
          '环境拓扑错配：云端 auth + 本机/same-origin proxy。预发请统一打同一套 auth/proxy，或 npm run env:profile:prod-like。',
        authKind,
        proxyKind,
      },
    };
  }

  return { ok: true, authKind, proxyKind, issue: null };
}

/** Browser: read Vite env once. */
export function evaluateBrowserAiEnvTopology(): AiEnvTopologyResult {
  let authBaseUrl = '';
  let proxyApi = '';
  let isDev = false;
  try {
    authBaseUrl = String(import.meta.env?.VITE_AUTH_API_BASE_URL || '').trim();
    proxyApi = String(import.meta.env?.VITE_AI_WORKER_PROXY_API || '').trim();
    isDev = Boolean(import.meta.env?.DEV && !import.meta.env?.PROD);
  } catch {
    /* ignore */
  }
  return evaluateAiEnvTopology({
    authBaseUrl,
    proxyApi,
    assumeEmptyAuthIsLocal: isDev,
  });
}

let loggedOnce = false;

/** Log once in DEV when mismatch — call from banner mount or first AI entry. */
export function warnAiEnvTopologyOnce(log: Pick<Console, 'warn'> = console): AiEnvTopologyResult {
  const result = evaluateBrowserAiEnvTopology();
  if (!result.ok && result.issue && !loggedOnce) {
    loggedOnce = true;
    try {
      if (import.meta.env?.DEV) {
        log.warn?.(`[ai-env-topology] ${result.issue.messageZh}`);
      }
    } catch {
      log.warn?.(`[ai-env-topology] ${result.issue.messageZh}`);
    }
  }
  return result;
}
