import { getDebugClientLogPersistEnabled } from './settingsStore';

type ClientDebugLogEntry = {
  time: number;
  module: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  detail?: string;
};

function sanitize(input: string): string {
  let s = String(input || '');
  s = s.replace(/(tsk_[a-zA-Z0-9_-]{8,})/g, '[REDACTED_TRIPO_KEY]');
  s = s.replace(/(AKID[a-zA-Z0-9]{8,})/g, '[REDACTED_TENCENT_ID]');
  s = s.replace(/(AIza[0-9A-Za-z\\-_]{20,})/g, '[REDACTED_GEMINI_KEY]');
  s = s.replace(/(Bearer\\s+)[^\\s"']+/gi, '$1[REDACTED_TOKEN]');
  s = s.replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]{64,}/g, '[REDACTED_IMAGE_BASE64]');
  if (s.length > 4000) s = `${s.slice(0, 4000)}…(truncated)`;
  return s;
}

export async function reportClientDebugLog(entry: ClientDebugLogEntry): Promise<void> {
  if (!getDebugClientLogPersistEnabled()) return;
  try {
    const payload = {
      time: entry.time,
      module: sanitize(entry.module),
      level: entry.level,
      message: sanitize(entry.message),
      detail: entry.detail ? sanitize(entry.detail) : undefined,
    };
    await fetch('/api/debug/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    /* 调试落盘失败不影响主流程 */
  }
}

