export type AuditTimePreset = '7d' | 'today' | '30d' | 'custom';

export const AUDIT_TIME_PRESETS: Array<{ id: AuditTimePreset; label: string }> = [
  { id: 'today', label: '今天' },
  { id: '7d', label: '近 7 天' },
  { id: '30d', label: '近 30 天' },
  { id: 'custom', label: '自定义' },
];

export function resolveAuditTimeRange(preset: AuditTimePreset, customFrom: string, customTo: string) {
  const now = new Date();
  if (preset === 'custom') {
    const from = customFrom ? new Date(customFrom).toISOString() : '';
    const to = customTo ? new Date(customTo).toISOString() : '';
    return { from, to };
  }
  if (preset === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: now.toISOString() };
  }
  if (preset === '30d') {
    const start = new Date(now.getTime() - 30 * 86400000);
    return { from: start.toISOString(), to: now.toISOString() };
  }
  const start = new Date(now.getTime() - 7 * 86400000);
  return { from: start.toISOString(), to: now.toISOString() };
}

/** datetime-local value from ISO */
export function isoToDatetimeLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
