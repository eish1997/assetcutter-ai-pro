import { describe, expect, it } from 'vitest';
import { formatPlanTemplate } from '../services/projectAgent/planTemplate';
import { buildProjectAgentIntent } from '../services/projectAgent/intent';
import {
  createProjectAgentRuntime,
  PROJECT_AGENT_CANCELLED_MESSAGE,
  PROJECT_AGENT_DUPLICATE_TURN_ID_MESSAGE,
} from '../services/projectAgent/runtime';
import { createMemoryHostPort } from '../services/projectAgent/host/memoryHostPort';
import {
  PROJECT_AGENT_THREAD_MAX_MESSAGES,
  appendProjectAgentThreadTurn,
  createProjectAgentThread,
  loadOrCreateProjectAgentThread,
  projectAgentThreadStorageKey,
  saveProjectAgentThread,
  trimProjectAgentThreadMessages,
} from '../services/projectAgent/threadStore';
import type { AgentPlannedTool, ProjectAgentIntent } from '../types/projectAgent';
import type { QuickComposeThreadMessage } from '../types/quickComposeThread';
import { mapPlanToQuickComposeInvoke } from '../components/project-agent/mapPlanToQuickComposeInvoke';
import { planTools } from '../services/projectAgent/planTools';

describe('formatPlanTemplate', () => {
  it('formats single preset', () => {
    const plan: AgentPlannedTool[] = [
      { toolId: 'run_preset', label: '运行预设', args: { presetId: 'style-a' } },
    ];
    expect(formatPlanTemplate(plan)).toBe('计划：运行预设「style-a」');
  });

  it('formats repeated labels with ×n', () => {
    const plan: AgentPlannedTool[] = [
      { toolId: 'run_preset', label: '运行预设', args: { presetId: 'a' } },
      { toolId: 'run_preset', label: '运行预设', args: { presetId: 'b' } },
    ];
    expect(formatPlanTemplate(plan)).toBe('计划：运行预设×2');
  });
});

describe('buildProjectAgentIntent', () => {
  it('trims ids and defaults surface', () => {
    const intent = buildProjectAgentIntent({
      text: 'hi',
      mode: 'image',
      presetIds: ['  p1  ', ''],
      mainAssetId: ' a1 ',
    });
    expect(intent.presetIds).toEqual(['p1']);
    expect(intent.mainAssetId).toBe('a1');
    expect(intent.surface.kind).toBe('none');
  });
});

describe('threadStore hot window', () => {
  it('trims to 80', () => {
    const msgs: QuickComposeThreadMessage[] = Array.from({ length: 90 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `t${i}`,
      timestamp: i,
    }));
    expect(trimProjectAgentThreadMessages(msgs)).toHaveLength(PROJECT_AGENT_THREAD_MAX_MESSAGES);
    expect(trimProjectAgentThreadMessages(msgs)[0]?.id).toBe('m10');
  });

  it('storage key is project-scoped without lightbox', () => {
    const key = projectAgentThreadStorageKey({ userId: 'u1', workspaceProjectId: 'proj' });
    expect(key).toContain('ac_project_agent_thread_v1');
    expect(key).toContain('p_proj');
    expect(key).not.toContain('lightbox');
  });

  it('append turn writes plan text', () => {
    const key = { userId: 'test-user-pa', workspaceProjectId: `proj-${Date.now()}` };
    const thread = appendProjectAgentThreadTurn(key, {
      userText: '画一只猫',
      planText: '计划：文生图',
      taskIds: ['task-1'],
    });
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]?.text).toBe('计划：文生图');
    expect(thread.messages[1]?.status).toBe('queued');
  });
});

describe('createProjectAgentRuntime.submitTurn', () => {
  it('plans, templates, and executes via host.executePlan', async () => {
    const mem = createMemoryHostPort();
    const host = {
      ...mem,
      executePlan: (_intent: ProjectAgentIntent, plan: AgentPlannedTool[]) => ({
        taskIds: plan.map((_, i) => `task-${i}`),
        taskAssetById: { 'task-0': 'asset-out' },
      }),
    };
    const runtime = createProjectAgentRuntime(host);
    const intent = buildProjectAgentIntent({ mode: 'image', text: '一只猫' });
    const result = await runtime.submitTurn({
      turnId: 'turn-phase2-1',
      threadId: 'thread-1',
      workspaceProjectId: 'proj-1',
      intent,
    });
    expect(result.ok).toBe(true);
    expect(result.plan.map((p) => p.toolId)).toEqual(['run_plain_t2i']);
    expect(result.planText).toBe('计划：文生图');
    expect(result.taskIds).toEqual(['task-0']);
  });

  it('rejects duplicate in-flight / duplicate turnId', async () => {
    const mem = createMemoryHostPort();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const host = {
      ...mem,
      executePlan: async () => {
        await gate;
        return { taskIds: ['t1'] };
      },
    };
    const runtime = createProjectAgentRuntime(host);
    const intent = buildProjectAgentIntent({ mode: 'text', text: 'hello' });
    const p1 = runtime.submitTurn({
      turnId: 'dup-1',
      threadId: 'th',
      workspaceProjectId: 'p',
      intent,
    });
    const blocked = await runtime.submitTurn({
      turnId: 'dup-2',
      threadId: 'th',
      workspaceProjectId: 'p',
      intent,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.errorMessage).toMatch(/in flight/i);
    release();
    const first = await p1;
    expect(first.ok).toBe(true);
  });

  it('rejects duplicate turnId after completion (§16.5)', async () => {
    const mem = createMemoryHostPort();
    const host = {
      ...mem,
      executePlan: () => ({ taskIds: ['t-done'] }),
    };
    const runtime = createProjectAgentRuntime(host);
    const intent = buildProjectAgentIntent({ mode: 'text', text: 'once' });
    const first = await runtime.submitTurn({
      turnId: 'same-turn-id',
      threadId: 'th',
      workspaceProjectId: 'p',
      intent,
    });
    expect(first.ok).toBe(true);
    const dup = await runtime.submitTurn({
      turnId: 'same-turn-id',
      threadId: 'th',
      workspaceProjectId: 'p',
      intent,
    });
    expect(dup.ok).toBe(false);
    expect(dup.errorMessage).toBe(PROJECT_AGENT_DUPLICATE_TURN_ID_MESSAGE);
  });

  it('cancelInFlight during executePlan returns cancelled and calls host.cancelTasks', async () => {
    const mem = createMemoryHostPort();
    const cancelled: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const host = {
      ...mem,
      executePlan: async () => {
        await gate;
        return { taskIds: ['cancel-me'] };
      },
      cancelTasks: (ids: string[]) => {
        cancelled.push(...ids);
        mem.cancelTasks?.(ids);
      },
    };
    const runtime = createProjectAgentRuntime(host);
    const intent = buildProjectAgentIntent({ mode: 'image', text: '慢任务' });
    const p = runtime.submitTurn({
      turnId: 'cancel-turn-1',
      threadId: 'th',
      workspaceProjectId: 'p',
      intent,
    });
    expect(runtime.getTurnState().status).toBe('executing');
    runtime.cancelInFlight();
    release();
    const result = await p;
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe(PROJECT_AGENT_CANCELLED_MESSAGE);
    expect(result.taskIds).toEqual(['cancel-me']);
    expect(cancelled).toContain('cancel-me');
    // 取消后可再提交新 turn
    const next = await runtime.submitTurn({
      turnId: 'after-cancel',
      threadId: 'th',
      workspaceProjectId: 'p',
      intent,
    });
    expect(next.ok).toBe(true);
  });

  it('cancelInFlight after done still cancels lastTaskIds via host', async () => {
    const mem = createMemoryHostPort();
    const cancelled: string[] = [];
    const host = {
      ...mem,
      executePlan: () => ({ taskIds: ['queued-media'] }),
      cancelTasks: (ids: string[]) => {
        cancelled.push(...ids);
      },
    };
    const runtime = createProjectAgentRuntime(host);
    const intent = buildProjectAgentIntent({ mode: 'image', text: '图' });
    await runtime.submitTurn({
      turnId: 'post-done-cancel',
      threadId: 'th',
      workspaceProjectId: 'p',
      intent,
    });
    expect(runtime.getLastTaskIds()).toEqual(['queued-media']);
    const { cancelledTaskIds } = runtime.cancelInFlight();
    expect(cancelledTaskIds).toEqual(['queued-media']);
    expect(cancelled).toEqual(['queued-media']);
  });
});

describe('createProjectAgentThread helpers', () => {
  it('create empty thread', () => {
    const t = createProjectAgentThread({ userId: null, workspaceProjectId: 'p' });
    expect(t.messages).toEqual([]);
    expect(loadOrCreateProjectAgentThread({ userId: `guest-${Date.now()}`, workspaceProjectId: 'p2' }).id).toBeTruthy();
    saveProjectAgentThread({ userId: 'x', workspaceProjectId: 'y' }, t);
  });
});

describe('mapPlanToQuickComposeInvoke', () => {
  it('maps text / t2i / preset / lightbox tools', () => {
    let n = 0;
    const key = () => `k${++n}`;
    const resolve = (id: string) => ({ label: `L-${id}`, instruction: `I-${id}` });

    const textIntent = buildProjectAgentIntent({ mode: 'text', text: 'hello' });
    const textPlan = planTools(textIntent);
    expect(textPlan.ok).toBe(true);
    if (!textPlan.ok) return;
    const textInv = mapPlanToQuickComposeInvoke(textIntent, textPlan.plan, resolve, key);
    expect(textInv.forceComposeMode).toBe('text');
    expect(textInv.preferTextPipelineWhenNoImagesAttached).toBe(true);

    const imgIntent = buildProjectAgentIntent({ mode: 'image', text: '一只猫' });
    const imgPlan = planTools(imgIntent);
    expect(imgPlan.ok).toBe(true);
    if (!imgPlan.ok) return;
    const imgInv = mapPlanToQuickComposeInvoke(imgIntent, imgPlan.plan, resolve, key);
    expect(imgInv.forceComposeMode).toBe('image');

    const presetIntent = buildProjectAgentIntent({
      mode: 'text',
      text: 'x',
      presetIds: ['p1', 'p2'],
    });
    const presetPlan = planTools(presetIntent);
    expect(presetPlan.ok).toBe(true);
    if (!presetPlan.ok) return;
    const presetInv = mapPlanToQuickComposeInvoke(presetIntent, presetPlan.plan, resolve, key);
    expect(presetInv.skipPromptCards).toBe(false);
    expect(presetInv.presetCardsOverride?.map((c) => c.presetId)).toEqual(['p1', 'p2']);

    const lbIntent = buildProjectAgentIntent({
      mode: 'image',
      text: '修一下',
      surface: { kind: 'lightbox', assetId: 'a1', displayKey: 'full', hasLocalEdit: true },
    });
    const lbPlan = planTools(lbIntent);
    expect(lbPlan.ok).toBe(true);
    if (!lbPlan.ok) return;
    const lbInv = mapPlanToQuickComposeInvoke(lbIntent, lbPlan.plan, resolve, key);
    expect(lbInv.useLightboxLocalEdit).toBe(true);
  });

  it('maps multiple invoke_expert steps to invokeExpertIds', () => {
    const intent = buildProjectAgentIntent({
      mode: 'text',
      text: '双专家',
      mentions: [
        { kind: 'expert', id: 'expert.prompt_smith', label: '提示词专家' },
        { kind: 'expert', id: 'expert.brief_outliner', label: '大纲分镜专家' },
      ],
    });
    const planned = planTools(intent);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const mapped = mapPlanToQuickComposeInvoke(intent, planned.plan, () => null, () => 'k');
    expect(mapped.invokeExpertIds?.length).toBeGreaterThan(1);
    expect(mapped.invokeExpertId).toBe(mapped.invokeExpertIds?.[0]);
  });
});
