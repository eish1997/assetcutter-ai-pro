import { describe, expect, it } from 'vitest';
import {
  countGlobalLogModules,
  DEFAULT_GLOBAL_LOG_FILTER,
  filterGlobalLogs,
  isAiAgentQueueNoiseLog,
  isGlobalLogFilterAtDefault,
  matchesGlobalLogLevelFilter,
  normalizeGlobalLogFilterPrefs,
  shouldShowTripoRecoveryBanner,
  globalLogFilterForPersist,
  sanitizeGlobalLogFilter,
  type GlobalLogEntry,
} from '../services/globalLogFilter';

function log(partial: Partial<GlobalLogEntry> & Pick<GlobalLogEntry, 'module' | 'level' | 'message'>): GlobalLogEntry {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    time: partial.time ?? Date.now(),
    ...partial,
  };
}

describe('globalLogFilter', () => {
  const logs: GlobalLogEntry[] = [
    log({ id: '1', module: '工作区', level: 'error', message: '任务失败', retryable: true, auditEventId: 'a1' }),
    log({ id: '2', module: '工作区', level: 'info', message: '队列开始' }),
    log({ id: '3', module: 'AI代理', level: 'info', message: '代理排队中' }),
    log({ id: '4', module: 'AI代理', level: 'warn', message: '限流' }),
    log({ id: '5', module: '生成3D', level: 'error', message: 'Tripo 超时' }),
  ];

  it('isAiAgentQueueNoiseLog matches AI代理 info only', () => {
    expect(isAiAgentQueueNoiseLog({ module: 'AI代理', level: 'info' })).toBe(true);
    expect(isAiAgentQueueNoiseLog({ module: 'AI代理', level: 'warn' })).toBe(false);
    expect(isAiAgentQueueNoiseLog({ module: '工作区', level: 'info' })).toBe(false);
  });

  it('filterGlobalLogs level important excludes info', () => {
    const out = filterGlobalLogs(logs, { ...DEFAULT_GLOBAL_LOG_FILTER, level: 'important' });
    expect(out.map((x) => x.id)).toEqual(['1', '4', '5']);
  });

  it('filterGlobalLogs hideAiQueueInfo removes AI代理 info', () => {
    const out = filterGlobalLogs(logs, { ...DEFAULT_GLOBAL_LOG_FILTER, level: 'all', hideAiQueueInfo: true });
    expect(out.some((x) => x.id === '3')).toBe(false);
    expect(out.some((x) => x.id === '4')).toBe(true);
  });

  it('filterGlobalLogs module and retryableOnly', () => {
    const out = filterGlobalLogs(logs, {
      ...DEFAULT_GLOBAL_LOG_FILTER,
      level: 'all',
      module: '工作区',
      retryableOnly: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('1');
  });

  it('filterGlobalLogs keyword searches message and detail', () => {
    const withDetail = [
      ...logs,
      log({ id: '6', module: '能力', level: 'warn', message: '执行异常', detail: 'unique-token-xyz' }),
    ];
    const out = filterGlobalLogs(withDetail, {
      ...DEFAULT_GLOBAL_LOG_FILTER,
      level: 'all',
      keyword: 'unique-token',
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('6');
  });

  it('countGlobalLogModules respects level filter but not module', () => {
    const counts = countGlobalLogModules(logs, { ...DEFAULT_GLOBAL_LOG_FILTER, level: 'important' });
    expect(counts).toEqual([
      { module: '工作区', count: 1 },
      { module: '生成3D', count: 1 },
      { module: 'AI代理', count: 1 },
    ]);
  });

  it('shouldShowTripoRecoveryBanner follows module and level', () => {
    const base = DEFAULT_GLOBAL_LOG_FILTER;
    expect(shouldShowTripoRecoveryBanner(base, 'tripo err')).toBe(true);
    expect(shouldShowTripoRecoveryBanner({ ...base, level: 'info' }, 'tripo err')).toBe(false);
    expect(shouldShowTripoRecoveryBanner({ ...base, module: '工作区' }, 'tripo err')).toBe(false);
    expect(shouldShowTripoRecoveryBanner({ ...base, retryableOnly: true }, 'tripo err')).toBe(false);
    expect(shouldShowTripoRecoveryBanner({ ...base, keyword: 'nomatch' }, 'tripo err')).toBe(false);
  });

  it('normalizeGlobalLogFilterPrefs and default check', () => {
    expect(normalizeGlobalLogFilterPrefs({ level: 'error', hideAiQueueInfo: false })).toMatchObject({
      level: 'error',
      hideAiQueueInfo: false,
    });
    expect(isGlobalLogFilterAtDefault(DEFAULT_GLOBAL_LOG_FILTER)).toBe(true);
    expect(isGlobalLogFilterAtDefault({ ...DEFAULT_GLOBAL_LOG_FILTER, keyword: 'x' })).toBe(false);
  });

  it('sanitizeGlobalLogFilter clears stale module', () => {
    const onlyWorkspace = [log({ id: '1', module: '工作区', level: 'warn', message: 'x' })];
    const stale = { ...DEFAULT_GLOBAL_LOG_FILTER, module: '能力' };
    expect(sanitizeGlobalLogFilter(onlyWorkspace, stale).module).toBe('all');
    expect(sanitizeGlobalLogFilter(onlyWorkspace, { ...stale, module: '工作区' }).module).toBe('工作区');
  });

  it('globalLogFilterForPersist omits keyword', () => {
    const persisted = globalLogFilterForPersist({ ...DEFAULT_GLOBAL_LOG_FILTER, keyword: 'find me' });
    expect(persisted).not.toHaveProperty('keyword');
    expect(persisted.level).toBe('important');
  });
});
