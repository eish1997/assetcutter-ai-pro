import { describe, expect, it } from 'vitest';
import { createControlledPlan, validateControlledPlan } from '../services/projectAgent/planner';
import { planTools } from '../services/projectAgent/planTools';
import { createProjectAgentRuntime } from '../services/projectAgent/runtime';
import type {
  AgentPlannedTool,
  ProjectAgentHostPort,
  ProjectAgentIntent,
} from '../types/projectAgent';
import { PROJECT_AGENT_MAX_TOOL_STEPS } from '../types/projectAgent';

function baseIntent(partial: Partial<ProjectAgentIntent> & Pick<ProjectAgentIntent, 'mode'>): ProjectAgentIntent {
  return {
    text: '',
    presetIds: [],
    mentions: [],
    surface: { kind: 'none' },
    ...partial,
  };
}

describe('controlled Project Agent planner (Phase 5)', () => {
  it('splits a compound copy plus image request into a validated multi-step plan', () => {
    const intent = baseIntent({
      mode: 'auto',
      text: '帮我写主图文案并生成高级护肤品主图',
    });

    const planned = createControlledPlan(intent);

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.output.plan.map((p) => p.toolId)).toEqual(['run_plain_text', 'run_plain_t2i']);
    expect(planned.output.validationIssues).toHaveLength(0);
    expect(planned.output.decisionTrace.map((item) => item.stage)).toContain('candidate');
  });

  it('validates tool whitelist, step cap, and required args', () => {
    const tooMany = Array.from({ length: PROJECT_AGENT_MAX_TOOL_STEPS + 1 }, (_, i) => ({
      toolId: 'run_preset',
      label: '运行预设',
      args: { presetId: `p-${i}` },
    })) satisfies AgentPlannedTool[];
    expect(validateControlledPlan(baseIntent({ mode: 'text', text: 'x' }), tooMany).map((i) => i.code)).toContain(
      'too_many_steps'
    );

    expect(
      validateControlledPlan(baseIntent({ mode: 'image', text: '换背景' }), [
        { toolId: 'run_plain_i2i', label: '图生图', args: {} },
      ]).map((i) => i.code)
    ).toContain('missing_asset');

    expect(
      validateControlledPlan(baseIntent({ mode: 'text', text: 'x' }), [
        { toolId: 'run_not_allowed' as never, label: 'bad' },
      ]).map((i) => i.code)
    ).toContain('unknown_tool');

    expect(
      validateControlledPlan(baseIntent({ mode: 'text', text: 'x' }), [
        { toolId: 'run_plain_text', label: 'bad args', args: [] as never },
      ]).map((i) => i.code)
    ).toContain('invalid_args');
  });

  it('uses an injected planner only after validation passes', () => {
    const planned = planTools(baseIntent({ mode: 'text', text: 'write a launch caption' }), {
      controlledPlanner: () => ({
        ok: true,
        plan: [{ toolId: 'run_preset', label: '', args: { presetId: 'preset-launch' } }],
        decisionTrace: [{ stage: 'candidate', message: 'external planner matched launch preset' }],
      }),
    });

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.map((p) => p.toolId)).toEqual(['run_preset']);
    expect(planned.plan[0]?.label).toBeTruthy();
    expect(planned.planner?.source).toBe('controlled');
    expect(planned.planner?.decisionTrace.some((item) => item.message.includes('accepted'))).toBe(true);
  });

  it('falls back to rule routing when an injected planner fails validation', () => {
    const planned = planTools(baseIntent({ mode: 'text', text: 'write a launch caption' }), {
      controlledPlanner: () => ({
        ok: true,
        plan: [{ toolId: 'run_not_allowed' as never, label: 'bad' }],
      }),
    });

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.map((p) => p.toolId)).toEqual(['run_plain_text']);
    expect(planned.planner?.source).toBe('rule_fallback');
    expect(planned.planner?.validationIssues.map((issue) => issue.code)).toContain('unknown_tool');
    expect(planned.planner?.decisionTrace.at(-1)?.stage).toBe('fallback');
  });

  it('returns clarify when an injected planner explicitly asks for missing details', () => {
    const planned = planTools(baseIntent({ mode: 'image', text: 'make it match this' }), {
      controlledPlanner: () => ({
        ok: false,
        clarifyMessage: 'Please choose the source image first',
        decisionTrace: [{ stage: 'candidate', message: 'external planner needs image context' }],
      }),
    });

    expect(planned.ok).toBe(false);
    const failed = planned as Extract<ReturnType<typeof planTools>, { ok: false }>;
    expect(failed.errorMessage).toBe('Please choose the source image first');
    expect(failed.clarifyMessage).toBe('Please choose the source image first');
    expect(failed.planner?.decisionTrace.at(-1)?.stage).toBe('clarify');
  });

  it('returns a clarify result instead of executing unsafe empty input', () => {
    const planned = planTools(baseIntent({ mode: 'text', text: '   ' }));

    expect(planned.ok).toBe(false);
    const failed = planned as Extract<ReturnType<typeof planTools>, { ok: false }>;
    expect(failed.planner?.decisionTrace.at(-1)?.stage).toBe('clarify');
    expect(failed.errorMessage).toContain('Empty text');
  });

  it('records planner decision trace on runtime traces', async () => {
    const host: ProjectAgentHostPort = {
      enqueueTasks: () => [],
      getQueueSnapshot: () => ({ pending: [], executing: [], assetErrors: {} }),
      resolveAssetDisplay: () => ({}),
      executePlan: () => ({ taskIds: ['task-1'] }),
    };
    const runtime = createProjectAgentRuntime(host);

    const result = await runtime.submitTurn({
      turnId: 'turn-planner-1',
      threadId: 'thread-1',
      workspaceProjectId: 'project-1',
      intent: baseIntent({
        mode: 'auto',
        text: '帮我写主图文案并生成高级护肤品主图',
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.plan.map((p) => p.toolId)).toEqual(['run_plain_text', 'run_plain_t2i']);
    expect(result.trace.plannerTrace?.some((item) => item.message.includes('compound'))).toBe(true);
  });

  it('passes a host-injected planner through runtime and keeps trace readable', async () => {
    const host: ProjectAgentHostPort = {
      enqueueTasks: () => [],
      getQueueSnapshot: () => ({ pending: [], executing: [], assetErrors: {} }),
      resolveAssetDisplay: () => ({}),
      controlledPlanner: () => ({
        ok: true,
        plan: [{ toolId: 'run_preset', label: 'Launch preset', args: { presetId: 'preset-launch' } }],
        decisionTrace: [{ stage: 'candidate', message: 'host planner selected launch preset' }],
      }),
      executePlan: () => ({ taskIds: ['task-host-planner'] }),
    };
    const runtime = createProjectAgentRuntime(host);

    const result = await runtime.submitTurn({
      turnId: 'turn-host-planner-1',
      threadId: 'thread-1',
      workspaceProjectId: 'project-1',
      intent: baseIntent({ mode: 'text', text: 'write launch copy' }),
    });

    expect(result.ok).toBe(true);
    expect(result.plan.map((p) => p.toolId)).toEqual(['run_preset']);
    expect(result.trace.plannerTrace?.some((item) => item.message.includes('host planner'))).toBe(true);
    expect(JSON.stringify(result.trace)).toContain('run_preset');
  });
});
