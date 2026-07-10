import { describe, expect, it } from 'vitest';
import { planTools } from '../services/projectAgent/planTools';
import { assertRegistryComplete, PROJECT_AGENT_TOOL_REGISTRY } from '../services/projectAgent/tools/registry';
import { createMemoryHostPort } from '../services/projectAgent/host/memoryHostPort';
import {
  canSubmitNewTurn,
  createInitialTurnState,
  transitionTurn,
} from '../services/projectAgent/runtime/turnState';
import {
  applyPlanToTrace,
  createEmptyTurnTrace,
  finalizeTurnTrace,
  serializeTurnTrace,
} from '../services/projectAgent/runtime/trace';
import type { AgentRouteCase, ProjectAgentIntent } from '../types/projectAgent';
import { PROJECT_AGENT_MAX_TOOL_STEPS, PROJECT_AGENT_TOOL_IDS } from '../types/projectAgent';

function baseIntent(partial: Partial<ProjectAgentIntent> & Pick<ProjectAgentIntent, 'mode'>): ProjectAgentIntent {
  return {
    text: '',
    presetIds: [],
    mentions: [],
    surface: { kind: 'none' },
    ...partial,
  };
}

const ROUTE_CASES: AgentRouteCase[] = [
  {
    id: 'mode_text_plain',
    intent: baseIntent({ mode: 'text', text: '写一句旁白' }),
    expectToolIds: ['run_plain_text'],
  },
  {
    id: 'mode_image_t2i',
    intent: baseIntent({ mode: 'image', text: '一只猫' }),
    expectToolIds: ['run_plain_t2i'],
  },
  {
    id: 'mode_image_i2i',
    intent: baseIntent({ mode: 'image', text: '换成雨天', mainAssetId: 'asset-1' }),
    expectToolIds: ['run_plain_i2i'],
  },
  {
    id: 'preset_single',
    intent: baseIntent({ mode: 'text', text: 'x', presetIds: ['preset-a'] }),
    expectToolIds: ['run_preset'],
  },
  {
    id: 'preset_multi',
    intent: baseIntent({ mode: 'image', text: 'x', presetIds: ['p1', 'p2'] }),
    expectToolIds: ['run_preset', 'run_preset'],
  },
  {
    id: 'preset_over_mode',
    intent: baseIntent({ mode: 'text', text: '忽略文模式', presetIds: ['img-preset'] }),
    expectToolIds: ['run_preset'],
    expectForbiddenToolIds: ['run_plain_text'],
  },
  {
    id: 'lightbox_local',
    intent: baseIntent({
      mode: 'image',
      text: '去掉电线',
      surface: { kind: 'lightbox', assetId: 'lb-1', displayKey: 'full', hasLocalEdit: true },
    }),
    expectToolIds: ['run_lightbox_local_edit'],
  },
  {
    id: 'mode_3d',
    intent: baseIntent({ mode: '3d', text: '角色', hasEnabled3dPreset: true }),
    expectToolIds: ['run_plain_3d'],
  },
  {
    id: 'mode_3d_none',
    intent: baseIntent({ mode: '3d', text: '角色', hasEnabled3dPreset: false }),
    expectToolIds: [],
    expectError: true,
  },
  {
    id: 'empty_text_no_ref',
    intent: baseIntent({ mode: 'text', text: '   ' }),
    expectToolIds: [],
    expectError: true,
  },
  {
    id: 'step_cap',
    intent: baseIntent({
      mode: 'text',
      text: 'x',
      presetIds: Array.from({ length: PROJECT_AGENT_MAX_TOOL_STEPS + 1 }, (_, i) => `p${i}`),
    }),
    expectToolIds: [],
    expectError: true,
  },
  {
    id: 'mention_expert_invoke',
    intent: baseIntent({
      mode: 'text',
      text: '@prompt_smith 写提示词',
    }),
    expectToolIds: ['invoke_expert'],
    expectForbiddenToolIds: ['run_plain_text'],
  },
  {
    id: 'mention_expert_kind',
    intent: baseIntent({
      mode: 'image',
      text: '优化',
      mentions: [{ kind: 'expert', id: 'expert.brief_outliner', label: '大纲分镜专家' }],
    }),
    expectToolIds: ['invoke_expert'],
    expectForbiddenToolIds: ['run_plain_t2i', 'run_plain_i2i'],
  },
  {
    id: 'mode_auto_text',
    intent: baseIntent({ mode: 'auto', text: '写一句旁白' }),
    expectToolIds: ['run_plain_text'],
  },
  {
    id: 'mode_auto_i2i',
    intent: baseIntent({ mode: 'auto', text: '换成雨天', mainAssetId: 'asset-1' }),
    expectToolIds: ['run_plain_i2i'],
  },
  {
    id: 'mode_auto_3d',
    intent: baseIntent({
      mode: 'auto',
      text: '生成3d角色',
      hasEnabled3dPreset: true,
    }),
    expectToolIds: ['run_plain_3d'],
  },
  {
    id: 'mode_auto_explicit_image_chip_unchanged',
    intent: baseIntent({ mode: 'image', text: '一只猫' }),
    expectToolIds: ['run_plain_t2i'],
  },
];

describe('projectAgent tool registry', () => {
  it('has tools matching frozen ids (P0 media + invoke_expert)', () => {
    assertRegistryComplete();
    expect(PROJECT_AGENT_TOOL_REGISTRY).toHaveLength(PROJECT_AGENT_TOOL_IDS.length);
    expect(PROJECT_AGENT_TOOL_REGISTRY.map((t) => t.id).sort()).toEqual([...PROJECT_AGENT_TOOL_IDS].sort());
    expect(PROJECT_AGENT_TOOL_IDS).toContain('invoke_expert');
  });
});

describe('planTools routing (§16.4)', () => {
  for (const c of ROUTE_CASES) {
    it(c.id, () => {
      const result = planTools(c.intent);
      if (c.expectError) {
        expect(result.ok).toBe(false);
        return;
      }
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.map((p) => p.toolId)).toEqual(c.expectToolIds);
      for (const forbidden of c.expectForbiddenToolIds ?? []) {
        expect(result.plan.map((p) => p.toolId)).not.toContain(forbidden);
      }
    });
  }
});

describe('turn state machine', () => {
  it('submit → plan_ok → exec_done', () => {
    let s = createInitialTurnState();
    expect(canSubmitNewTurn(s.status)).toBe(true);
    s = transitionTurn(s, { type: 'submit', turnId: 't1' });
    expect(s.status).toBe('planning');
    expect(canSubmitNewTurn(s.status)).toBe(false);
    s = transitionTurn(s, { type: 'plan_ok' });
    expect(s.status).toBe('executing');
    s = transitionTurn(s, { type: 'exec_done' });
    expect(s.status).toBe('done');
    expect(canSubmitNewTurn(s.status)).toBe(true);
  });

  it('cancel from executing becomes error with reason cancelled', () => {
    let s = createInitialTurnState();
    s = transitionTurn(s, { type: 'submit', turnId: 't2' });
    s = transitionTurn(s, { type: 'plan_ok' });
    s = transitionTurn(s, { type: 'cancel' });
    expect(s.status).toBe('error');
    expect(s.errorMessage).toBe('cancelled');
  });
});

describe('turn trace', () => {
  it('serializes a full planning trace without throwing', () => {
    const intent = baseIntent({ mode: 'image', text: '猫', mainAssetId: 'a1' });
    let trace = createEmptyTurnTrace({
      turnId: 'turn-1',
      threadId: 'thread-1',
      workspaceProjectId: 'proj-1',
      intent,
    });
    const planned = planTools(intent);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    trace = applyPlanToTrace(trace, planned.plan);
    trace = finalizeTurnTrace(trace, 'done');
    const json = serializeTurnTrace(trace);
    expect(json).toContain('run_plain_i2i');
    expect(JSON.parse(json).turnId).toBe('turn-1');
  });
});

describe('createMemoryHostPort', () => {
  it('enqueues tasks and resolves display', () => {
    const host = createMemoryHostPort({
      assetLabels: { a1: { label: 'Hero' } },
      surface: { kind: 'canvas', selectedAssetIds: ['a1'] },
    });
    const ids = host.enqueueTasks([{ id: 'task-1' } as never]);
    expect(ids).toEqual(['task-1']);
    expect(host.getQueueSnapshot().pending).toHaveLength(1);
    expect(host.resolveAssetDisplay('a1').label).toBe('Hero');
    expect(host.reportSurfaceContext?.().kind).toBe('canvas');
  });
});
