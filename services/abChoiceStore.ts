/**
 * ac_ab_choices 的唯一读写入口。
 * 所有对比选择的读写必须通过本模块，业务代码不得直接访问 localStorage 的 ac_ab_choices。
 * 见 docs/PROMPT_OPTIMIZATION_AB_DESIGN.md。
 */

import type { ABChoice } from '../types';

const STORAGE_KEY = 'ac_ab_choices';
const MAX_RECORDS = 200;

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export function loadChoices(): ABChoice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as ABChoice[];
    if (!Array.isArray(list)) return [];
    return [...list].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  } catch {
    return [];
  }
}

function saveChoices(records: ABChoice[]): void {
  const sorted = [...records].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const trimmed = sorted.slice(0, MAX_RECORDS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

export function addChoice(record: Omit<ABChoice, 'id'>): ABChoice {
  const full: ABChoice = { ...record, id: genId() };
  const list = loadChoices();
  list.unshift(full);
  saveChoices(list);
  return full;
}
