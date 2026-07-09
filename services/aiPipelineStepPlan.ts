import type { CustomAppModule } from '../types';

export type CapabilityPipelineStep = {
  key: 'understand' | 'image_create' | 'text_gen' | 'run';
  label: string;
};

/** 图生图/文生图能力：规划串行步骤（用于 UI「步骤 i/n」） */
export function planCapabilityPipelineSteps(
  preset: Pick<CustomAppModule, 'category' | 'engine'>,
  opts: { runUnderstand: boolean }
): CapabilityPipelineStep[] {
  const isGenImage =
    preset.category === 'text_to_image' ||
    (preset.category === 'image_to_image' && preset.engine === 'gen_image');
  if (!isGenImage) {
    return [{ key: 'run', label: '执行' }];
  }
  const steps: CapabilityPipelineStep[] = [];
  if (opts.runUnderstand) {
    steps.push({ key: 'understand', label: '理解' });
  }
  steps.push({ key: 'image_create', label: '生图' });
  return steps;
}

export function formatPipelineStepProgress(stepIndex: number, stepTotal: number, message: string): string {
  const msg = String(message || '').trim();
  if (stepTotal <= 1) return msg;
  const i = Math.max(1, Math.min(stepIndex, stepTotal));
  return `步骤 ${i}/${stepTotal} · ${msg}`;
}
