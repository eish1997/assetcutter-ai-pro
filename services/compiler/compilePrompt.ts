import type { CustomAppModule } from '../../types';
import type { AppliedRuleRef } from '../../types/vgp';

export const RULE_COMPILER_VERSION = 'rule-compiler-1.0.0';

export type CompilePromptInput = {
  preset: CustomAppModule;
  /** 优先：用户微调或目标摘要 */
  targetSummary?: string;
  dimensions?: Record<string, string | undefined>;
};

/**
 * 结构化 Prompt：英文指令，用于图生图模型；不调用 LLM。
 */
export function compilePromptForCapability(input: CompilePromptInput): {
  compiled_prompt: string;
  applied_rules: AppliedRuleRef[];
  compiler_version: string;
} {
  const { preset, targetSummary, dimensions } = input;
  const label = (preset.label || preset.id).trim();
  const instruction = (preset.instruction || '').trim();
  const summary = (targetSummary || '').trim();
  const dimParts = Object.entries(dimensions || {})
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${v}`);

  const parts: string[] = [
    'Edit and transform the uploaded image according to the following capability.',
    `Capability: ${label}.`,
  ];
  if (summary) parts.push(`User intent / target: ${summary}.`);
  if (instruction) parts.push(`Preset instruction (follow closely): ${instruction}.`);
  if (dimParts.length) parts.push(`Constraints: ${dimParts.join('; ')}.`);
  parts.push(
    'Preserve the main subject and composition unless the instruction explicitly asks to change them. Output a single edited image.'
  );

  const compiled_prompt = parts.join(' ');

  return {
    compiled_prompt,
    applied_rules: [
      { ruleId: 'compiler.template.preset_v1', detail: preset.id },
      ...(summary ? [{ ruleId: 'compiler.input.target_summary' as const }] : []),
    ],
    compiler_version: RULE_COMPILER_VERSION,
  };
}
