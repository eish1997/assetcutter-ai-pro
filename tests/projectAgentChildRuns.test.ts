import { describe, expect, it } from 'vitest';
import {
  buildChildRunsFromPlan,
  patchChildRunsFromTasks,
  type PatchChildRunsContext,
} from '../services/projectAgent/childRuns';
import type { AgentPlannedTool } from '../types/projectAgent';
import { QUICK_COMPOSE_CANCELLED_MESSAGE } from '../services/quickComposeTurnContext';

const emptyCtx = (over: Partial<PatchChildRunsContext> = {}): PatchChildRunsContext => ({
  pending: [],
  executingQueue: null,
  activeTaskIds: new Set(),
  completedTaskIds: new Set(),
  assetErrors: new Map(),
  cancelledTaskIds: new Set(),
  resolveModule: () => null,
  ...over,
});

describe('buildChildRunsFromPlan', () => {
  it('maps invoke_expert → kind expert and others → tool', () => {
    const plan: AgentPlannedTool[] = [
      {
        toolId: 'invoke_expert',
        label: '提示词专家',
        args: { expertId: 'prompt_smith' },
      },
      { toolId: 'run_plain_t2i', label: '文生图' },
    ];
    const runs = buildChildRunsFromPlan(plan, { now: 1000, parentMessageId: 'msg-1' });
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      kind: 'expert',
      label: '提示词专家',
      expertId: 'prompt_smith',
      toolId: 'invoke_expert',
      status: 'queued',
      parentMessageId: 'msg-1',
      startedAt: 1000,
    });
    expect(runs[1]).toMatchObject({
      kind: 'tool',
      label: '文生图',
      toolId: 'run_plain_t2i',
      status: 'queued',
    });
    expect(runs[1]!.expertId).toBeUndefined();
  });

  it('assigns flat taskIds 1:1 when lengths match', () => {
    const plan: AgentPlannedTool[] = [
      { toolId: 'run_preset', label: 'A' },
      { toolId: 'run_preset', label: 'B' },
    ];
    const runs = buildChildRunsFromPlan(plan, {
      now: 1,
      taskIds: ['t1', 't2'],
    });
    expect(runs[0]!.taskIds).toEqual(['t1']);
    expect(runs[1]!.taskIds).toEqual(['t2']);
  });

  it('gives all taskIds to the single step', () => {
    const plan: AgentPlannedTool[] = [{ toolId: 'run_plain_t2i', label: '文生图' }];
    const runs = buildChildRunsFromPlan(plan, { taskIds: ['a', 'b', 'c'], now: 1 });
    expect(runs[0]!.taskIds).toEqual(['a', 'b', 'c']);
  });

  it('distributes flat taskIds evenly when flat.length > planLen', () => {
    const plan: AgentPlannedTool[] = [
      { toolId: 'run_preset', label: 'A' },
      { toolId: 'run_preset', label: 'B' },
    ];
    // 5 ids / 2 steps → 前 rem=1 步多 1：A=[t1,t2,t3], B=[t4,t5]
    const runs = buildChildRunsFromPlan(plan, {
      now: 1,
      taskIds: ['t1', 't2', 't3', 't4', 't5'],
    });
    expect(runs[0]!.taskIds).toEqual(['t1', 't2', 't3']);
    expect(runs[1]!.taskIds).toEqual(['t4', 't5']);
  });

  it('prefers taskIdsByStep over flat taskIds', () => {
    const plan: AgentPlannedTool[] = [
      { toolId: 'run_preset', label: 'A' },
      { toolId: 'run_preset', label: 'B' },
    ];
    const runs = buildChildRunsFromPlan(plan, {
      now: 1,
      taskIds: ['orphan1', 'orphan2', 'orphan3'],
      taskIdsByStep: [['s1a', 's1b'], ['s2']],
    });
    expect(runs[0]!.taskIds).toEqual(['s1a', 's1b']);
    expect(runs[1]!.taskIds).toEqual(['s2']);
  });

  it('returns empty for empty plan', () => {
    expect(buildChildRunsFromPlan([])).toEqual([]);
  });

  it('does not put media-like fields on child runs', () => {
    const plan: AgentPlannedTool[] = [
      { toolId: 'run_plain_i2i', label: '图生图', args: { note: 'x' } },
    ];
    const [run] = buildChildRunsFromPlan(plan, { now: 1 });
    const json = JSON.stringify(run);
    expect(json).not.toMatch(/data:image|base64/i);
    expect(run).not.toHaveProperty('preview');
    expect(run).not.toHaveProperty('imageBase64');
  });
});

describe('patchChildRunsFromTasks', () => {
  it('advances child with taskIds: queued → running → done', () => {
    const plan: AgentPlannedTool[] = [{ toolId: 'run_plain_t2i', label: '文生图' }];
    const [initial] = buildChildRunsFromPlan(plan, { taskIds: ['t1'], now: 10 });
    expect(initial!.status).toBe('queued');

    const running = patchChildRunsFromTasks(
      [initial!],
      emptyCtx({
        pending: [{ id: 't1', assetId: 'a1', actionType: 'plain_t2i' } as never],
        activeTaskIds: new Set(['t1']),
        now: 20,
      })
    );
    expect(running[0]!.status).toBe('running');

    const done = patchChildRunsFromTasks(
      running,
      emptyCtx({
        completedTaskIds: new Set(['t1']),
        now: 30,
      })
    );
    expect(done[0]!.status).toBe('done');
    expect(done[0]!.endedAt).toBe(30);
  });

  it('marks cancelled when all taskIds cancelled', () => {
    const runs = buildChildRunsFromPlan(
      [{ toolId: 'run_plain_text', label: '文生文' }],
      { taskIds: ['t1'], now: 1 }
    );
    const patched = patchChildRunsFromTasks(
      runs,
      emptyCtx({
        cancelledTaskIds: new Set(['t1']),
        now: 2,
      })
    );
    expect(patched[0]!.status).toBe('cancelled');
    expect(patched[0]!.errorMessage).toBe(QUICK_COMPOSE_CANCELLED_MESSAGE);
  });

  it('approximates from messageStatus when child has no taskIds', () => {
    const runs = buildChildRunsFromPlan(
      [
        { toolId: 'invoke_expert', label: '专家A', args: { expertId: 'a' } },
        { toolId: 'invoke_expert', label: '专家B', args: { expertId: 'b' } },
      ],
      { now: 1 }
    );
    const mid = patchChildRunsFromTasks(
      runs,
      emptyCtx({ messageStatus: 'running', now: 2 })
    );
    expect(mid.map((r) => r.status)).toEqual(['running', 'queued']);

    const done = patchChildRunsFromTasks(
      mid,
      emptyCtx({ messageStatus: 'done', now: 3 })
    );
    expect(done.every((r) => r.status === 'done')).toBe(true);
  });

  it('approximates error → all error (not only last card)', () => {
    const runs = buildChildRunsFromPlan(
      [
        { toolId: 'invoke_expert', label: '专家A', args: { expertId: 'a' } },
        { toolId: 'invoke_expert', label: '专家B', args: { expertId: 'b' } },
        { toolId: 'invoke_expert', label: '专家C', args: { expertId: 'c' } },
      ],
      { now: 1 }
    );
    const patched = patchChildRunsFromTasks(
      runs,
      emptyCtx({
        messageStatus: 'error',
        messageErrorMessage: 'boom',
        now: 2,
      })
    );
    expect(patched.map((r) => r.status)).toEqual(['error', 'error', 'error']);
    expect(patched.every((r) => r.errorMessage === 'boom')).toBe(true);
  });

  it('approximates cancelled message → all cancelled', () => {
    const runs = buildChildRunsFromPlan(
      [
        { toolId: 'invoke_expert', label: '专家A', args: { expertId: 'a' } },
        { toolId: 'invoke_expert', label: '专家B', args: { expertId: 'b' } },
      ],
      { now: 1 }
    );
    const patched = patchChildRunsFromTasks(
      runs,
      emptyCtx({
        messageStatus: 'error',
        messageErrorMessage: QUICK_COMPOSE_CANCELLED_MESSAGE,
        now: 2,
      })
    );
    expect(patched.map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
    expect(patched.every((r) => r.errorMessage === QUICK_COMPOSE_CANCELLED_MESSAGE)).toBe(
      true
    );
  });

  it('returns same reference when unchanged', () => {
    const runs = buildChildRunsFromPlan(
      [{ toolId: 'run_plain_text', label: '文' }],
      { now: 1 }
    );
    const patched = patchChildRunsFromTasks(
      runs,
      emptyCtx({ messageStatus: 'queued' })
    );
    expect(patched).toBe(runs);
  });
});
