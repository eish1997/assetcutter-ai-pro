import { describe, expect, it } from 'vitest';

import { compilePromptForCapability, RULE_COMPILER_VERSION } from '../services/compiler/compilePrompt';
import type { CustomAppModule } from '../types';

function makeGenPreset(partial: Partial<CustomAppModule>): CustomAppModule {
  return {
    id: 'test-preset',
    label: '测试能力',
    category: 'image_to_image',
    instruction: '把主体变亮',
    ...partial,
  };
}

describe('compilePromptForCapability', () => {
  it('拼接模板与目标摘要', () => {
    const out = compilePromptForCapability({
      preset: makeGenPreset({}),
      targetSummary: '更柔和的光',
    });
    expect(out.compiled_prompt).toContain('User intent / target: 更柔和的光');
    expect(out.compiled_prompt).toContain('Preset instruction');
    expect(out.compiler_version).toBe(RULE_COMPILER_VERSION);
    expect(out.applied_rules.some((r) => r.ruleId === 'compiler.input.target_summary')).toBe(true);
  });

  it('无 targetSummary 时不附加 target 规则引用', () => {
    const out = compilePromptForCapability({
      preset: makeGenPreset({ instruction: '仅预设' }),
    });
    expect(out.compiled_prompt.length).toBeGreaterThan(20);
    expect(out.applied_rules.some((r) => r.ruleId === 'compiler.input.target_summary')).toBe(false);
  });
});
