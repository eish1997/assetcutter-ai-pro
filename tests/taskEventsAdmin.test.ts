import { describe, expect, it } from 'vitest';
import {
  decodeTaskEventCursor,
  encodeTaskEventCursor,
} from '../server/workflow-task-events-store.js';
import { redactTaskEventRow } from '../server/admin-task-events.js';
import { taskEventCodeLabel, taskEventSummary } from '../services/taskEventSummary';

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
