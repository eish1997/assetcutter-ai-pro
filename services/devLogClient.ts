import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';
import type { DevLogEntry, DevLogIndex } from '../types/devLog';

export async function fetchDevLogIndex(): Promise<DevLogIndex> {
  return requestJson<DevLogIndex>(apiUrl('/api/admin/dev-log/index'), { cache: 'no-store' });
}

export async function fetchDevLogDay(dayKey: string): Promise<{ dayKey: string; entries: DevLogEntry[] }> {
  const q = new URLSearchParams({ dayKey });
  return requestJson(apiUrl(`/api/admin/dev-log/day?${q}`), { cache: 'no-store' });
}

export async function fetchDevLogEntry(
  dayKey: string,
  entryId: string
): Promise<{ entry: DevLogEntry }> {
  const q = new URLSearchParams({ dayKey, entryId });
  return requestJson(apiUrl(`/api/admin/dev-log/entry?${q}`), { cache: 'no-store' });
}

/** Aggregate day summary for receipt header */
export function buildDayReceiptSummary(entries: DevLogEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    for (const b of e.summaryBullets || []) {
      const t = String(b || '').trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 6) return out;
    }
  }
  if (!out.length) out.push('本日暂无推送摘要');
  return out;
}
