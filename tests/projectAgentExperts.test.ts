import { describe, expect, it, beforeEach } from 'vitest';
import { planTools } from '../services/projectAgent/planTools';
import {
  EXPERT_BRIEF_OUTLINER_ID,
  EXPERT_PROMPT_SMITH_ID,
  __resetExpertRegistryForTests,
  getExpertProfile,
  listExpertProfiles,
  resolveExpertByMention,
} from '../services/projectAgent/experts/registry';
import { invokeExpert } from '../services/projectAgent/experts/invoke';
import { detectExpertTuneProposals } from '../services/projectAgent/experts/tuneProtocol';
import {
  createQuickComposeMention,
  listExpertMentionCandidates,
} from '../services/quickComposeMention';
import { mapPlanToQuickComposeInvoke } from '../components/project-agent/mapPlanToQuickComposeInvoke';
import type { ProjectAgentIntent } from '../types/projectAgent';

function baseIntent(partial: Partial<ProjectAgentIntent> & Pick<ProjectAgentIntent, 'mode'>): ProjectAgentIntent {
  return {
    text: '',
    presetIds: [],
    mentions: [],
    surface: { kind: 'none' },
    ...partial,
  };
}

describe('projectAgent experts registry (4A)', () => {
  beforeEach(() => {
    __resetExpertRegistryForTests();
  });

  it('lists two builtin experts that resolve by id and alias', () => {
    const list = listExpertProfiles();
    expect(list.map((p) => p.expertId).sort()).toEqual(
      [EXPERT_BRIEF_OUTLINER_ID, EXPERT_PROMPT_SMITH_ID].sort()
    );
    expect(getExpertProfile(EXPERT_PROMPT_SMITH_ID)?.displayName).toBe('提示词专家');
    expect(resolveExpertByMention('prompt_smith')?.expertId).toBe(EXPERT_PROMPT_SMITH_ID);
    expect(resolveExpertByMention('@提示词专家')?.expertId).toBe(EXPERT_PROMPT_SMITH_ID);
    expect(resolveExpertByMention('brief_outliner')?.expertId).toBe(EXPERT_BRIEF_OUTLINER_ID);
    expect(resolveExpertByMention('大纲分镜专家')?.expertId).toBe(EXPERT_BRIEF_OUTLINER_ID);
  });

  it('mention candidates include both experts', () => {
    const cands = listExpertMentionCandidates(
      [],
      listExpertProfiles().map((p) => ({ expertId: p.expertId, displayName: p.displayName }))
    );
    expect(cands).toHaveLength(2);
    expect(cands.every((c) => c.kind === 'expert')).toBe(true);
    const m = createQuickComposeMention(cands[0]!, []);
    expect(m?.kind).toBe('expert');
    if (m?.kind === 'expert') {
      expect(m.expertId).toBe(cands[0]!.expertId);
    }
  });
});

describe('mention_expert_routes (§17.6)', () => {
  it('routes @prompt_smith text to invoke_expert with expertId', () => {
    const result = planTools(
      baseIntent({
        mode: 'text',
        text: '@prompt_smith 帮我写一条胶片感提示词',
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.map((p) => p.toolId)).toEqual(['invoke_expert']);
    expect(result.plan[0]?.args?.expertId).toBe(EXPERT_PROMPT_SMITH_ID);
  });

  it('routes mention kind:expert to invoke_expert', () => {
    const result = planTools(
      baseIntent({
        mode: 'text',
        text: '优化这段提示词',
        mentions: [{ kind: 'expert', id: EXPERT_PROMPT_SMITH_ID, label: '提示词专家' }],
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan[0]?.toolId).toBe('invoke_expert');
    expect(result.plan[0]?.args?.expertId).toBe(EXPERT_PROMPT_SMITH_ID);
  });
});

describe('second_expert_same_pipe (§17.6 / 4E)', () => {
  it('routes second expert via same invoke_expert tool id', () => {
    const result = planTools(
      baseIntent({
        mode: 'text',
        text: '@brief_outliner 写三镜大纲',
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.map((p) => p.toolId)).toEqual(['invoke_expert']);
    expect(result.plan[0]?.args?.expertId).toBe(EXPERT_BRIEF_OUTLINER_ID);
  });

  it('invokes both experts through the same invokeExpert pipe with distinct profiles', async () => {
    const base = {
      userText: '雨夜巷口的追逐',
      turnId: 'turn-pipe',
      threadId: 'thread-1',
      workspaceProjectId: 'proj-1',
      userId: 'user-1',
      preferDeterministicDraft: true as const,
    };
    const a = await invokeExpert({ ...base, expertId: EXPERT_PROMPT_SMITH_ID, turnId: 'turn-a' });
    const b = await invokeExpert({ ...base, expertId: EXPERT_BRIEF_OUTLINER_ID, turnId: 'turn-b' });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.expertId).toBe(EXPERT_PROMPT_SMITH_ID);
    expect(b.expertId).toBe(EXPERT_BRIEF_OUTLINER_ID);
    expect(a.text).toBeTruthy();
    expect(b.text).toBeTruthy();
    expect(a.text).not.toEqual(b.text);
    expect(a.artifactIds.length).toBeGreaterThan(0);
    expect(b.artifactIds.length).toBeGreaterThan(0);
    expect(a.text).toContain('提示词');
    expect(b.text).toMatch(/大纲|分镜/);
  });

  it('uses Host generateText when provided (real LLM path)', async () => {
    const calls: Array<{ system: string; user: string; model?: string }> = [];
    const result = await invokeExpert({
      expertId: EXPERT_PROMPT_SMITH_ID,
      userText: '胶片感人像',
      turnId: 'turn-llm-1',
      threadId: 'thread-1',
      workspaceProjectId: 'proj-1',
      userId: 'user-1',
      textModel: 'gemini-test',
      generateText: async (args) => {
        calls.push(args);
        return 'LLM 炼出的提示词正文';
      },
    });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('LLM 炼出的提示词正文');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).toContain('提示词专家');
    expect(calls[0]?.user).toContain('胶片感人像');
    expect(calls[0]?.model).toBe('gemini-test');
  });

  it('falls back to deterministic draft when generateText throws', async () => {
    const result = await invokeExpert({
      expertId: EXPERT_PROMPT_SMITH_ID,
      userText: '赛博朋克街道',
      turnId: 'turn-llm-fail',
      threadId: 'thread-1',
      workspaceProjectId: 'proj-1',
      userId: 'user-1',
      generateText: async () => {
        throw new Error('network down');
      },
    });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('模型暂不可用');
    expect(result.text).toContain('提示词草稿');
    expect(result.text).toContain('赛博朋克街道');
  });
});

describe('mapPlan multi invoke_expert → invokeExpertIds', () => {
  it('maps multiple invoke_expert steps to invokeExpertIds.length > 1', () => {
    const intent = baseIntent({
      mode: 'text',
      text: '一起处理',
      mentions: [
        { kind: 'expert', id: EXPERT_PROMPT_SMITH_ID, label: '提示词专家' },
        { kind: 'expert', id: EXPERT_BRIEF_OUTLINER_ID, label: '大纲分镜专家' },
      ],
    });
    const planned = planTools(intent);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.map((p) => p.toolId)).toEqual(['invoke_expert', 'invoke_expert']);

    const mapped = mapPlanToQuickComposeInvoke(
      intent,
      planned.plan,
      () => null,
      () => 'k'
    );
    expect(mapped.invokeExpertIds).toEqual([
      EXPERT_PROMPT_SMITH_ID,
      EXPERT_BRIEF_OUTLINER_ID,
    ]);
    expect(mapped.invokeExpertIds!.length).toBeGreaterThan(1);
    expect(mapped.invokeExpertId).toBe(EXPERT_PROMPT_SMITH_ID);
  });
});

describe('tuneProtocol no_silent_memory (4A detect)', () => {
  it('ordinary chat yields no proposals', () => {
    const proposals = detectExpertTuneProposals(
      baseIntent({ mode: 'text', text: '帮我润色一下这句话' }),
      EXPERT_PROMPT_SMITH_ID,
      { userId: 'u1' }
    );
    expect(proposals).toEqual([]);
  });

  it('记住 → memory proposal; 改人设 → profilePatch; 加工具 → skillRequest', () => {
    expect(
      detectExpertTuneProposals(
        baseIntent({ mode: 'text', text: '记住以后都偏胶片感' }),
        EXPERT_PROMPT_SMITH_ID
      )[0]?.kind
    ).toBe('memory');
    expect(
      detectExpertTuneProposals(
        baseIntent({ mode: 'text', text: '把人设改成更像广告文案，禁区加不要血腥' }),
        EXPERT_PROMPT_SMITH_ID
      )[0]?.kind
    ).toBe('profilePatch');
    expect(
      detectExpertTuneProposals(
        baseIntent({ mode: 'text', text: '给提示词专家加上能直接存预设' }),
        EXPERT_PROMPT_SMITH_ID
      )[0]?.kind
    ).toBe('skillRequest');
  });

  it('memory proposal fills scope.userId (and optional workspaceProjectId) from opts', () => {
    const proposals = detectExpertTuneProposals(
      baseIntent({ mode: 'text', text: '记住以后都偏胶片感' }),
      EXPERT_PROMPT_SMITH_ID,
      { userId: 'user-tune-1', workspaceProjectId: 'ws-proj-9' }
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.kind).toBe('memory');
    expect(proposals[0]?.memoryDraft?.scope).toEqual({
      userId: 'user-tune-1',
      expertId: EXPERT_PROMPT_SMITH_ID,
      workspaceProjectId: 'ws-proj-9',
    });
  });
});
