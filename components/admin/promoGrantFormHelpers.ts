/** 活动积分发放表单 — Admin 面板共用 */

export const PROMO_EXPIRY_PRESETS = [
  { value: '+7d', label: '7 天后到期' },
  { value: '+30d', label: '30 天后到期' },
  { value: '+60d', label: '60 天后到期' },
  { value: '+90d', label: '90 天后到期' },
  { value: 'custom', label: '指定日期时间' },
] as const;

export type PromoExpiryPreset = (typeof PROMO_EXPIRY_PRESETS)[number]['value'];

export function defaultPromoCustomExpiryLocal(): string {
  const d = new Date(Date.now() + 30 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function resolvePromoExpiresAt(preset: string, customLocal: string): string {
  if (preset === 'custom') {
    const text = customLocal.trim();
    if (!text) throw new Error('请选择到期时间');
    const t = new Date(text).getTime();
    if (!Number.isFinite(t)) throw new Error('到期时间无效');
    if (t <= Date.now()) throw new Error('到期时间须在未来');
    return new Date(t).toISOString();
  }
  const p = String(preset || '+30d').trim();
  if (!/^\+(\d+(?:\.\d+)?)[dh]$/i.test(p)) throw new Error('有效期预设无效');
  return p;
}

export function previewPromoExpiresAt(preset: string, customLocal: string): string {
  try {
    const raw = resolvePromoExpiresAt(preset, customLocal);
    if (raw.startsWith('+')) {
      const rel = /^\+(\d+(?:\.\d+)?)([dh])$/i.exec(raw);
      if (!rel) return '';
      const n = Number(rel[1]);
      const ms = rel[2].toLowerCase() === 'd' ? n * 86_400_000 : n * 3_600_000;
      return new Date(Date.now() + ms).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return new Date(raw).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export type PromoGrantRecipientRow = {
  key: string;
  username: string;
  amount: string;
};

export function newRecipientRow(): PromoGrantRecipientRow {
  return { key: `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, username: '', amount: '' };
}
