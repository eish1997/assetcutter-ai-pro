import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../server/auth-store.js', () => ({
  readDb: vi.fn(),
  writeDb: vi.fn(),
  USE_POSTGRES: false,
  getPool: vi.fn(),
  ensurePostgres: vi.fn(),
}));

import { readDb, writeDb } from '../server/auth-store.js';
import { isSyncableTaskEventCode } from '../shared/taskEventSyncPrefixes.js';
import {
  decodeTaskEventCursor,
  encodeTaskEventCursor,
  insertWorkflowTaskEvents,
  listWorkflowTaskEventsForAdmin,
} from '../server/workflow-task-events-store.js';
import { redactTaskEventRow } from '../server/admin-task-events.js';
import { taskEventCodeLabel, taskEventSummary } from '../services/taskEventSummary';

const baseEvent = {
  id: 'wa_test_1',
  ts: 1_717_600_000_000,
  level: 'info' as const,
  code: 'RUN_TASK_SUCCESS',
  message: '执行完成',
  userId: 'user-a',
};

describe('workflow task event code guard', () => {
  it('accepts RUN_TASK_* and STORYBOARD_* only', () => {
    expect(isSyncableTaskEventCode('RUN_TASK_SUCCESS')).toBe(true);
    expect(isSyncableTaskEventCode('STORYBOARD_GEN_SUCCESS')).toBe(true);
    expect(isSyncableTaskEventCode('EXPORT_IMAGE')).toBe(false);
  });
});

describe('insertWorkflowTaskEvents (json)', () => {
  beforeEach(() => {
    vi.mocked(readDb).mockReturnValue({
      users: [],
      sessions: [],
      workflowTaskEvents: [],
    });
    vi.mocked(writeDb).mockReset();
  });

  it('ignores non RUN_TASK events', async () => {
    const result = await insertWorkflowTaskEvents('user-a', [
      { ...baseEvent, code: 'EXPORT_IMAGE' },
    ]);
    expect(result).toEqual({ inserted: 0, skipped: 0 });
    expect(writeDb).not.toHaveBeenCalled();
  });

  it('persists STORYBOARD events', async () => {
    const result = await insertWorkflowTaskEvents('user-a', [
      { ...baseEvent, code: 'STORYBOARD_GEN_SUCCESS', message: '分镜表 · 任务 1 生图完成' },
    ]);
    expect(result.inserted).toBe(1);
  });

  it('persists RUN_TASK events', async () => {
    const result = await insertWorkflowTaskEvents('user-a', [baseEvent]);
    expect(result.inserted).toBe(1);
    expect(writeDb).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(writeDb).mock.calls[0]?.[0] as {
      workflowTaskEvents: Array<{ code: string }>;
    };
    expect(saved.workflowTaskEvents[0]?.code).toBe('RUN_TASK_SUCCESS');
  });
});

describe('listWorkflowTaskEventsForAdmin (json)', () => {
  beforeEach(() => {
    vi.mocked(readDb).mockReturnValue({
      users: [{ id: 'user-a', username: 'alice' }],
      sessions: [],
      workflowTaskEvents: [
        {
          id: 'wa_1',
          userId: 'user-a',
          ts: 1_717_600_000_000,
          level: 'info',
          code: 'RUN_TASK_SUCCESS',
          message: 'ok',
        },
        {
          id: 'wa_2',
          userId: 'user-b',
          ts: 1_717_500_000_000,
          level: 'error',
          code: 'RUN_TASK_CAPABILITY_EXCEPTION',
          message: 'fail',
        },
      ],
    });
  });

  it('filters by username substring', async () => {
    const res = await listWorkflowTaskEventsForAdmin({ userId: 'ali', limit: '50' });
    expect(res.total).toBe(1);
    expect(res.events[0]?.username).toBe('alice');
  });

  it('does not expose next page when filtered rows fit one page', async () => {
    const res = await listWorkflowTaskEventsForAdmin({ limit: '50' });
    expect(res.events).toHaveLength(2);
    expect(res.nextCursor).toBeNull();
  });
});

describe('task event cursor', () => {
  it('round-trips encode/decode', () => {
    const row = {
      id: 'wa_abc',
      tsMs: 1717600000000,
      source: 'workflow' as const,
    };
    const cursor = encodeTaskEventCursor(row);
    expect(cursor).toBeTruthy();
    const decoded = decodeTaskEventCursor(cursor);
    expect(decoded?.id).toBe('wa_abc');
    expect(decoded?.tsMs).toBe(1717600000000);
  });
});

describe('task event redact', () => {
  it('truncates long user ids for auditor', () => {
    const out = redactTaskEventRow({
      id: '1',
      source: 'workflow',
      userId: 'user-abcdefghijklmnop',
      ts: new Date().toISOString(),
      tsMs: Date.now(),
      level: 'info',
      code: 'RUN_TASK_SUCCESS',
      message: 'ok',
      detail: { actionType: 'cap_preset_1' },
    });
    expect(String(out.userId).endsWith('…')).toBe(true);
  });
});

describe('taskEventSummary', () => {
  it('labels RUN_TASK_SUCCESS', () => {
    expect(taskEventCodeLabel('RUN_TASK_SUCCESS')).toBe('任务成功');
    const s = taskEventSummary({
      code: 'RUN_TASK_SUCCESS',
      message: '[文生图] 执行完成',
      username: 'alice',
      detail: { actionType: 'cap_preset_1' },
    });
    expect(s).toContain('@alice');
    expect(s).toContain('任务成功');
  });
});
