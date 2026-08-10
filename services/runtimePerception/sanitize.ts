const DATA_URL_RE = /data:[^;,\s]+;base64,[A-Za-z0-9+/=\s]+/gi;
const LONG_BASE64_RE = /(?:^|[\s"'])([A-Za-z0-9+/]{80,}={0,2})(?=$|[\s"'])/g;
const SECRET_RE =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|(?:api[_-]?key|token|cookie|secret|password)\s*[:=]\s*[^\s,;]+)/gi;
const WINDOWS_PATH_RE = /\b[A-Za-z]:\\(?:[^\\\s]+\\){2,}[^\\\s]*/g;
const POSIX_PATH_RE = /(?:^|\s)\/(?:Users|home|var|tmp|mnt|Volumes)\/[^\s,;]+/g;

export const RUNTIME_PERCEPTION_SUMMARY_MAX_CHARS = 240;

export function sanitizeRuntimePerceptionText(
  value: unknown,
  maxChars = RUNTIME_PERCEPTION_SUMMARY_MAX_CHARS
): string {
  const text = String(value ?? '')
    .replace(DATA_URL_RE, '[omitted-base64]')
    .replace(LONG_BASE64_RE, ' [omitted-base64]')
    .replace(SECRET_RE, '[omitted-secret]')
    .replace(WINDOWS_PATH_RE, '[local-path]')
    .replace(POSIX_PATH_RE, ' [local-path]')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

export function uniqueCleanStrings(values: readonly unknown[], limit = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = sanitizeRuntimePerceptionText(value, 120);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}
