import { readLocalJson, scopedStorageKey, writeLocalJson } from './clientPersist';

export type GlobalLogLevel = 'info' | 'warn' | 'error';

export type GlobalLogEntry = {
  id: string;
  time: number;
  module: string;
  level: GlobalLogLevel;
  message: string;
  detail?: string;
  auditEventId?: string;
  retryable?: boolean;
};

export type GlobalLogLevelFilter = 'all' | 'important' | 'error' | 'warn' | 'info';

export type GlobalLogFilterState = {
  level: GlobalLogLevelFilter;
  module: 'all' | string;
  retryableOnly: boolean;
  keyword: string;
  hideAiQueueInfo: boolean;
};

export const GLOBAL_LOG_FILTER_PREFS_KEY = 'global_log_filter_prefs_v1';

export const DEFAULT_GLOBAL_LOG_FILTER: GlobalLogFilterState = {
  level: 'important',
  module: 'all',
  retryableOnly: false,
  keyword: '',
  hideAiQueueInfo: true,
};

/** 写入顺序：工作区优先，其余按常见噪声从低到高 */
export const GLOBAL_LOG_MODULE_ORDER = [
  '工作区',
  '能力',
  '生成3D',
  '提取花纹',
  '贴图修缝',
  '生成贴图',
  'AI代理',
] as const;

const LEVEL_FILTERS: GlobalLogLevelFilter[] = ['all', 'important', 'error', 'warn', 'info'];

function moduleSortIndex(module: string): number {
  const idx = GLOBAL_LOG_MODULE_ORDER.indexOf(module as (typeof GLOBAL_LOG_MODULE_ORDER)[number]);
  return idx === -1 ? GLOBAL_LOG_MODULE_ORDER.length : idx;
}

export function isAiAgentQueueNoiseLog(log: Pick<GlobalLogEntry, 'module' | 'level'>): boolean {
  return log.module === 'AI代理' && log.level === 'info';
}

export function matchesGlobalLogLevelFilter(level: GlobalLogLevel, filter: GlobalLogLevelFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'important') return level === 'warn' || level === 'error';
  return level === filter;
}

export function filterGlobalLogs(logs: GlobalLogEntry[], filter: GlobalLogFilterState): GlobalLogEntry[] {
  const kw = filter.keyword.trim().toLowerCase();
  return logs.filter((log) => {
    if (filter.hideAiQueueInfo && isAiAgentQueueNoiseLog(log)) return false;
    if (!matchesGlobalLogLevelFilter(log.level, filter.level)) return false;
    if (filter.module !== 'all' && log.module !== filter.module) return false;
    if (filter.retryableOnly) {
      if (!log.retryable || !log.auditEventId) return false;
      if (log.level !== 'warn' && log.level !== 'error') return false;
    }
    if (kw) {
      const hay = `${log.message}\n${log.detail ?? ''}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

export function countGlobalLogModules(
  logs: GlobalLogEntry[],
  filter: GlobalLogFilterState
): Array<{ module: string; count: number }> {
  const partial = filterGlobalLogs(logs, { ...filter, module: 'all' });
  const map = new Map<string, number>();
  for (const log of partial) {
    map.set(log.module, (map.get(log.module) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort(([a], [b]) => moduleSortIndex(a) - moduleSortIndex(b))
    .map(([module, count]) => ({ module, count }));
}

export function isGlobalLogFilterAtDefault(filter: GlobalLogFilterState): boolean {
  return (
    filter.level === DEFAULT_GLOBAL_LOG_FILTER.level &&
    filter.module === DEFAULT_GLOBAL_LOG_FILTER.module &&
    filter.retryableOnly === DEFAULT_GLOBAL_LOG_FILTER.retryableOnly &&
    filter.keyword.trim() === '' &&
    filter.hideAiQueueInfo === DEFAULT_GLOBAL_LOG_FILTER.hideAiQueueInfo
  );
}

export function normalizeGlobalLogFilterPrefs(parsed: unknown): GlobalLogFilterState | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = parsed as Partial<GlobalLogFilterState>;
  const level = LEVEL_FILTERS.includes(raw.level as GlobalLogLevelFilter)
    ? (raw.level as GlobalLogLevelFilter)
    : DEFAULT_GLOBAL_LOG_FILTER.level;
  const module =
    raw.module === 'all' || (typeof raw.module === 'string' && raw.module.trim())
      ? raw.module === 'all'
        ? 'all'
        : String(raw.module).trim()
      : DEFAULT_GLOBAL_LOG_FILTER.module;
  return {
    level,
    module,
    retryableOnly: raw.retryableOnly === true,
    keyword: '',
    hideAiQueueInfo: raw.hideAiQueueInfo !== false,
  };
}

export function readGlobalLogFilterPrefs(scope: string | null | undefined): GlobalLogFilterState {
  return readLocalJson(
    scopedStorageKey(GLOBAL_LOG_FILTER_PREFS_KEY, scope),
    DEFAULT_GLOBAL_LOG_FILTER,
    normalizeGlobalLogFilterPrefs
  );
}

/** 持久化时不写入 keyword，避免每次按键写 localStorage；搜索词仅会话内有效 */
export function globalLogFilterForPersist(filter: GlobalLogFilterState): Omit<GlobalLogFilterState, 'keyword'> & {
  keyword?: never;
} {
  const { keyword: _keyword, ...rest } = filter;
  return rest;
}

export function writeGlobalLogFilterPrefs(scope: string | null | undefined, filter: GlobalLogFilterState): void {
  writeLocalJson(scopedStorageKey(GLOBAL_LOG_FILTER_PREFS_KEY, scope), globalLogFilterForPersist(filter));
}

export function shouldShowTripoRecoveryBanner(
  filter: GlobalLogFilterState,
  tripoLastError: string | null | undefined
): boolean {
  if (!String(tripoLastError || '').trim()) return false;
  if (filter.level === 'info') return false;
  if (filter.module !== 'all' && filter.module !== '生成3D') return false;
  if (filter.retryableOnly) return false;
  const kw = filter.keyword.trim().toLowerCase();
  if (kw && !String(tripoLastError).toLowerCase().includes(kw)) return false;
  return true;
}

/** 当前来源在日志中已无匹配项时，回退为「全部来源」避免空列表 */
export function sanitizeGlobalLogFilter(
  logs: GlobalLogEntry[],
  filter: GlobalLogFilterState
): GlobalLogFilterState {
  if (filter.module === 'all') return filter;
  const modules = countGlobalLogModules(logs, filter);
  if (modules.some((m) => m.module === filter.module)) return filter;
  return { ...filter, module: 'all' };
}
