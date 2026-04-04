/**
 * ac_winning_snippets 的唯一读写入口。
 * 所有获胜片段的读写必须通过本模块，业务代码不得直接访问 localStorage 的 ac_winning_snippets。
 * 见 docs/PROMPT_OPTIMIZATION_AB_DESIGN.md。
 */

import type { WinningSnippet } from '../types';
import { readLocalJson, writeLocalJson } from './clientPersist';

const STORAGE_KEY = 'ac_winning_snippets';
const MAX_RECORDS = 100;

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function parseSnippets(parsed: unknown): WinningSnippet[] | null {
  if (!Array.isArray(parsed)) return null;
  return [...(parsed as WinningSnippet[])].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

export function loadSnippets(): WinningSnippet[] {
  return readLocalJson<WinningSnippet[]>(STORAGE_KEY, [], parseSnippets);
}

function saveSnippets(records: WinningSnippet[]): void {
  const sorted = [...records].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const trimmed = sorted.slice(0, MAX_RECORDS);
  writeLocalJson(STORAGE_KEY, trimmed);
}

export function addSnippet(snippet: Omit<WinningSnippet, 'id'>): WinningSnippet {
  const full: WinningSnippet = { ...snippet, id: genId(), source: snippet.source ?? 'ab_choice' };
  const list = loadSnippets();
  list.unshift(full);
  saveSnippets(list);
  return full;
}

export function removeSnippet(id: string): void {
  const list = loadSnippets().filter((s) => s.id !== id);
  saveSnippets(list);
}
