import { isPairingRevoked } from './pairingSession.js';

/**
 * 安装包版收紧模型（P0 宿主侧）：可选 Origin 白名单 + 可选共享 Bearer。
 * 未设置环境变量时保持开发期宽松行为（与已决清单 §3 一致）。
 */

export function getSharedToken(): string {
  return process.env.COMPANION_SHARED_TOKEN?.trim() ?? '';
}

export function isBearerAuthEnabled(): boolean {
  return getSharedToken().length > 0;
}

/** 逗号分隔；未设置或为空表示不启用白名单。支持条目 `http://localhost:*`、`http://127.0.0.1:*` 匹配任意端口。 */
export function parseAllowedOriginEntries(): string[] | null {
  const raw = process.env.COMPANION_ALLOWED_ORIGINS?.trim();
  if (!raw) return null;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

function originEntryMatches(requestOrigin: string, entry: string): boolean {
  if (entry === requestOrigin) return true;
  if (entry === 'http://localhost:*' && /^http:\/\/localhost:\d+$/.test(requestOrigin)) return true;
  if (entry === 'http://127.0.0.1:*' && /^http:\/\/127.0.0.1:\d+$/.test(requestOrigin)) return true;
  return false;
}

/** 无 Origin 头（同源简单请求、curl、本机控制台）视为允许。 */
export function isOriginAllowed(requestOrigin: string | undefined, entries: string[] | null): boolean {
  if (!entries) return true;
  if (!requestOrigin) return true;
  return entries.some((e) => originEntryMatches(requestOrigin, e));
}

export type BearerCheck = 'ok' | 'missing' | 'invalid' | 'revoked';

export function checkBearerAuthorization(header: string | undefined): BearerCheck {
  const expected = getSharedToken();
  if (!expected) return 'ok';
  if (isPairingRevoked()) return 'revoked';
  const raw = typeof header === 'string' ? header.trim() : '';
  if (!raw.toLowerCase().startsWith('bearer ')) {
    return raw ? 'invalid' : 'missing';
  }
  const token = raw.slice(7).trim();
  if (token !== expected) return 'invalid';
  return 'ok';
}

/** 不设 Token 时不校验；仅对「需保护的 API」在 httpHandler 中调用。 */
export function isBearerExemptPath(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  if (m === 'OPTIONS') return true;
  if (pathname === '/v1/health' && m === 'GET') return true;
  if ((pathname === '/' || pathname === '/index.html') && m === 'GET') return true;
  if (pathname === '/v1/pairing/session' && m === 'GET') return true;
  return false;
}

export function getAccessPublicSummary() {
  const entries = parseAllowedOriginEntries();
  return {
    originAllowlistEnabled: Boolean(entries?.length),
    originAllowlistEntries: entries ?? [],
    bearerRequired: isBearerAuthEnabled(),
  };
}
