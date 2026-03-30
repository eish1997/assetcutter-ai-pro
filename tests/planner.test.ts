import { describe, expect, it } from 'vitest';

import { planPipeline } from '../services/planner/planPipeline';
import type { PlannerRulesetDocument } from '../types/planner';

const sampleRuleset: PlannerRulesetDocument = {
  ruleset_version: 'test',
  planner_id: 't',
  rules: [
    {
      id: 'high',
      priority: 100,
      enabled: true,
      when: { target_keywords_any: ['写实'], source_kind: 'any' },
      then: { steps: [{ preset_id: 'a', label: 'A' }, { preset_id: 'b', label: 'B' }] },
      reason: '写实链',
    },
    {
      id: 'low',
      priority: 10,
      enabled: true,
      when: { target_keywords_any: ['线稿'], source_kind: 'any' },
      then: { steps: [{ preset_id: 'a', label: '仅 A' }] },
      reason: '线稿单步',
    },
  ],
};

describe('planPipeline', () => {
  it('按关键词命中高优先级规则并过滤不可用预设', () => {
    const plan = planPipeline({
      inputProfile: { source_kind: 'unknown' },
      targetSummary: '要写实风格',
      ruleset: sampleRuleset,
      availablePresetIds: new Set(['a']),
    });
    expect(plan.fallback_used).toBe(false);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.preset_id).toBe('a');
  });

  it('无命中时 fallback_used 且 steps 为空', () => {
    const plan = planPipeline({
      inputProfile: { source_kind: 'unknown' },
      targetSummary: '完全无关的词',
      ruleset: sampleRuleset,
      availablePresetIds: new Set(['a', 'b']),
    });
    expect(plan.fallback_used).toBe(true);
    expect(plan.steps).toHaveLength(0);
  });

  it('source_kind 不匹配时跳过规则', () => {
    const plan = planPipeline({
      inputProfile: { source_kind: 'sketch' },
      targetSummary: '写实',
      ruleset: {
        ...sampleRuleset,
        rules: [
          {
            id: 'photo_only',
            priority: 100,
            enabled: true,
            when: { target_keywords_any: ['写实'], source_kind: 'photo' },
            then: { steps: [{ preset_id: 'a' }] },
            reason: '仅照片',
          },
        ],
      },
      availablePresetIds: new Set(['a']),
    });
    expect(plan.fallback_used).toBe(true);
  });
});
