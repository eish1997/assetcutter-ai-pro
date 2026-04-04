import type { CustomAppModule } from '../types';
import { readLocalJson, writeLocalJson } from './clientPersist';

export type InstalledStorePack = {
  id: string;
  type: 'capability_presets';
  name: string;
  version: string;
  url: string;
  sha256?: string;
  installedAt: number;
};

export type StorePackVersionSnapshot = {
  version: string;
  installedAt: number;
  sha256?: string;
  /** 当时安装的包内容（用于本地历史版本切换/回滚） */
  presets: CustomAppModule[];
};

const STORAGE_KEY_INSTALLED = 'ac_store_installed_packs';
const STORAGE_KEY_HISTORY = 'ac_store_pack_history';
const MAX_HISTORY_PER_PACK = 20;

function parseInstalledPacks(parsed: unknown): InstalledStorePack[] | null {
  if (!Array.isArray(parsed)) return null;
  return parsed as InstalledStorePack[];
}

type HistoryMap = Record<string, StorePackVersionSnapshot[]>;

function parseHistoryMap(parsed: unknown): HistoryMap | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as HistoryMap;
}

export function loadInstalledPacks(): InstalledStorePack[] {
  return readLocalJson<InstalledStorePack[]>(STORAGE_KEY_INSTALLED, [], parseInstalledPacks);
}

export function saveInstalledPacks(list: InstalledStorePack[]): void {
  writeLocalJson(STORAGE_KEY_INSTALLED, list);
}

export function loadPackHistory(packId: string): StorePackVersionSnapshot[] {
  const map = readLocalJson<HistoryMap>(STORAGE_KEY_HISTORY, {}, parseHistoryMap);
  const list = map[packId];
  return Array.isArray(list) ? list : [];
}

function saveHistoryMap(map: HistoryMap): void {
  writeLocalJson(STORAGE_KEY_HISTORY, map);
}

export function pushPackHistory(packId: string, snapshot: StorePackVersionSnapshot): void {
  try {
    const map = readLocalJson<HistoryMap>(STORAGE_KEY_HISTORY, {}, parseHistoryMap);
    const list = Array.isArray(map[packId]) ? map[packId] : [];
    const next = [snapshot, ...list].slice(0, MAX_HISTORY_PER_PACK);
    saveHistoryMap({ ...map, [packId]: next });
  } catch {
    // ignore
  }
}
