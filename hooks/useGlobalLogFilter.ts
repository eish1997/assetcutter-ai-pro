import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  countGlobalLogModules,
  DEFAULT_GLOBAL_LOG_FILTER,
  filterGlobalLogs,
  globalLogFilterForPersist,
  isGlobalLogFilterAtDefault,
  readGlobalLogFilterPrefs,
  sanitizeGlobalLogFilter,
  writeGlobalLogFilterPrefs,
  type GlobalLogEntry,
  type GlobalLogFilterState,
} from '../services/globalLogFilter';

export function useGlobalLogFilter(logs: GlobalLogEntry[], preferenceScope: string | null) {
  const [filter, setFilter] = useState<GlobalLogFilterState>(() => readGlobalLogFilterPrefs(preferenceScope));
  const preferenceScopeRef = useRef(preferenceScope);
  preferenceScopeRef.current = preferenceScope;

  useEffect(() => {
    setFilter((prev) => ({ ...readGlobalLogFilterPrefs(preferenceScope), keyword: prev.keyword }));
  }, [preferenceScope]);

  const persistFilter = useCallback((next: GlobalLogFilterState) => {
    writeGlobalLogFilterPrefs(preferenceScopeRef.current, globalLogFilterForPersist(next));
  }, []);

  const effectiveFilter = useMemo(() => sanitizeGlobalLogFilter(logs, filter), [logs, filter]);

  useEffect(() => {
    if (effectiveFilter.module === filter.module) return;
    setFilter((prev) => {
      const next = { ...prev, module: effectiveFilter.module };
      persistFilter(next);
      return next;
    });
  }, [effectiveFilter.module, filter.module, persistFilter]);

  const patchFilter = useCallback(
    (patch: Partial<GlobalLogFilterState>) => {
      setFilter((prev) => {
        const next = { ...prev, ...patch };
        persistFilter(next);
        return next;
      });
    },
    [persistFilter]
  );

  const resetFilter = useCallback(() => {
    const next = { ...DEFAULT_GLOBAL_LOG_FILTER };
    setFilter(next);
    persistFilter(next);
  }, [persistFilter]);

  const filteredLogs = useMemo(() => filterGlobalLogs(logs, effectiveFilter), [logs, effectiveFilter]);
  const moduleCounts = useMemo(
    () => countGlobalLogModules(logs, effectiveFilter),
    [logs, effectiveFilter]
  );

  return {
    filter: effectiveFilter,
    patchFilter,
    resetFilter,
    filteredLogs,
    moduleCounts,
    isFilterDefault: isGlobalLogFilterAtDefault(effectiveFilter),
  };
}
