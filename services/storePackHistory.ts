import type { CustomAppModule } from '../types';

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

export function loadInstalledPacks(): InstalledStorePack[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INSTALLED);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InstalledStorePack[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveInstalledPacks(list: InstalledStorePack[]): void {
  localStorage.setItem(STORAGE_KEY_INSTALLED, JSON.stringify(list));
}

type HistoryMap = Record<string, StorePackVersionSnapshot[]>;

export function loadPackHistory(packId: string): StorePackVersionSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryMap;
    const list = parsed?.[packId];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveHistoryMap(map: HistoryMap): void {
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(map));
}

export function pushPackHistory(packId: string, snapshot: StorePackVersionSnapshot): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    const parsed = raw ? (JSON.parse(raw) as HistoryMap) : ({} as HistoryMap);
    const list = Array.isArray(parsed[packId]) ? parsed[packId] : [];
    const next = [snapshot, ...list].slice(0, MAX_HISTORY_PER_PACK);
    parsed[packId] = next;
    saveHistoryMap(parsed);
  } catch {
    // ignore
  }
}

