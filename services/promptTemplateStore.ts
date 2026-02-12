import type { PromptTemplate } from '../types';

const STORAGE_KEY = 'ac_prompt_templates';

function normalizeTemplate(t: PromptTemplate): PromptTemplate | null {
  if (!t || typeof t !== 'object') return null;
  const id = String((t as PromptTemplate).id || '').trim();
  const name = String((t as PromptTemplate).name || '').trim();
  const text = String((t as PromptTemplate).text || '').trim();
  if (!id || !name || !text) return null;
  const tags = Array.isArray((t as PromptTemplate).tags)
    ? (t as PromptTemplate).tags!.map((x) => String(x)).filter(Boolean).slice(0, 20)
    : undefined;
  const note = (t as PromptTemplate).note != null ? String((t as PromptTemplate).note) : undefined;
  const updatedAt = typeof (t as PromptTemplate).updatedAt === 'number' ? (t as PromptTemplate).updatedAt : undefined;
  return { id, name, text, tags, note, updatedAt };
}

export function loadPromptTemplates(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PromptTemplate[];
    if (!Array.isArray(parsed)) return [];
    const out: PromptTemplate[] = [];
    for (const item of parsed) {
      const n = normalizeTemplate(item);
      if (n) out.push(n);
    }
    // 最近更新优先
    return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  } catch {
    return [];
  }
}

export function savePromptTemplates(list: PromptTemplate[]): void {
  const normalized: PromptTemplate[] = [];
  for (const item of list) {
    const n = normalizeTemplate(item);
    if (n) normalized.push(n);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

/**
 * 合并覆盖：以 id 为键写入；existing 里同 id 会被 next 覆盖。
 * 返回合并后的完整列表。
 */
export function mergePromptTemplates(existing: PromptTemplate[], next: PromptTemplate[]): PromptTemplate[] {
  const map = new Map<string, PromptTemplate>();
  for (const t of existing) {
    const n = normalizeTemplate(t);
    if (n) map.set(n.id, n);
  }
  const now = Date.now();
  for (const t of next) {
    const n = normalizeTemplate(t);
    if (!n) continue;
    map.set(n.id, { ...n, updatedAt: now });
  }
  return Array.from(map.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

