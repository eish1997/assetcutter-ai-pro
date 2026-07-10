import { describe, expect, it } from 'vitest';
import {
  deriveAssistantTimeline,
  resolveAssistantPlanLabels,
} from '../services/projectAgent/assistantTimeline';
import { QUICK_COMPOSE_CANCELLED_MESSAGE } from '../services/quickComposeTurnContext';

describe('resolveAssistantPlanLabels', () => {
  it('prefers planSteps over plan text', () => {
    expect(
      resolveAssistantPlanLabels({
        text: '计划：旧文案',
        planSteps: [{ label: '文生图' }, { label: '调用专家' }],
      })
    ).toEqual(['文生图', '调用专家']);
  });

  it('parses arrow plan text', () => {
    expect(
      resolveAssistantPlanLabels({ text: '计划：A → B → C' })
    ).toEqual(['A', 'B', 'C']);
  });
});

describe('deriveAssistantTimeline (P0.5-d)', () => {
  it('maps queued → plan done, queue active, tools pending', () => {
    const model = deriveAssistantTimeline({
      role: 'assistant',
      status: 'queued',
      text: '计划：文生图',
      planSteps: [{ label: '文生图', toolId: 'run_text_to_image' }],
    });
    expect(model?.inFlight).toBe(true);
    expect(model?.steps.map((s) => [s.id, s.state])).toEqual([
      ['plan', 'done'],
      ['queue', 'active'],
      ['tool-0', 'pending'],
      ['finish', 'pending'],
    ]);
  });

  it('maps running → queue done, first tool active', () => {
    const model = deriveAssistantTimeline({
      role: 'assistant',
      status: 'running',
      text: '计划：A → B',
      planSteps: [{ label: 'A' }, { label: 'B' }],
    });
    expect(model?.steps.find((s) => s.id === 'queue')?.state).toBe('done');
    expect(model?.steps.find((s) => s.id === 'tool-0')?.state).toBe('active');
    expect(model?.steps.find((s) => s.id === 'tool-1')?.state).toBe('pending');
  });

  it('maps done → all tools and finish done', () => {
    const model = deriveAssistantTimeline({
      role: 'assistant',
      status: 'done',
      text: '计划：文生文',
      planSteps: [{ label: '文生文' }],
    });
    expect(model?.inFlight).toBe(false);
    expect(model?.steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('maps cancelled → finish error label 已取消', () => {
    const model = deriveAssistantTimeline({
      role: 'assistant',
      status: 'error',
      text: '计划：文生图',
      errorMessage: QUICK_COMPOSE_CANCELLED_MESSAGE,
      planSteps: [{ label: '文生图' }],
    });
    expect(model?.cancelled).toBe(true);
    expect(model?.steps.find((s) => s.id === 'finish')).toMatchObject({
      label: '已取消',
      state: 'error',
    });
  });

  it('returns null for user messages', () => {
    expect(
      deriveAssistantTimeline({
        role: 'user',
        status: 'submitted',
        text: 'hello',
      })
    ).toBeNull();
  });
});
