/**
 * ac_generation_records 的唯一读写入口。
 * 所有生成记录的读写必须通过本模块，业务代码不得直接访问 localStorage 的 ac_generation_records。
 * 升级触发条件见 docs/PROMPT_SCORING_DESIGN.md；满足时仅替换本实现（如改为调用后端 API），调用方不变。
 */

import type { GenerationRecord } from '../types';

const STORAGE_KEY = 'ac_generation_records';
const MAX_RECORDS = 500;

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/** 读取当前列表，保证返回数组，按 timestamp 降序 */
export function loadRecords(): GenerationRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as GenerationRecord[];
    if (!Array.isArray(list)) return [];
    return [...list].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  } catch {
    return [];
  }
}

/** 写入前按 timestamp 降序并截断至 MAX_RECORDS */
export function saveRecords(records: GenerationRecord[]): void {
  const sorted = [...records].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const trimmed = sorted.slice(0, MAX_RECORDS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

/** 生成 id、追加记录、保存并返回完整记录 */
export function addRecord(record: Omit<GenerationRecord, 'id'>): GenerationRecord {
  const full: GenerationRecord = { ...record, id: genId() };
  const list = loadRecords();
  list.unshift(full);
  saveRecords(list);
  return full;
}

/** 按 id 更新 userScore 与 userScoreAt */
export function updateScore(id: string, userScore: number): void {
  const list = loadRecords();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], userScore, userScoreAt: Date.now() };
  saveRecords(list);
}
