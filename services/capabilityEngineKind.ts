import type { CustomAppModule } from '../types';
import { resolveImageProcessorId } from './capabilityProcessors/imageProcessProcessors';

/** 轻量引擎判定：避免 storyboard ↔ capabilityExecutor 模块环（WorkflowSection 同时 import 两侧） */

export function getCapabilityEngine(preset: CustomAppModule): 'gen_image' | 'gen_text' | 'builtin' {
  const cat = preset.category;
  if (cat === 'image_to_image' && (preset.engine === 'gen_image' || preset.engine === 'gen_text')) {
    return preset.engine;
  }
  if (cat === 'image_process') {
    if (preset.companionSamSegment === true) return 'builtin';
    if (preset.companionRembg === true) return 'builtin';
    if (preset.companionHostBundle?.dirName?.trim()) return 'builtin';
  }
  if (preset.engine) return preset.engine;
  if (cat === 'text_to_text' || cat === 'image_to_text') return 'gen_text';
  if (cat === 'text_to_image') return 'gen_image';
  if (cat === 'image_process' || (cat as string) === 'image_process') return 'builtin';
  if (cat === 'image_to_image') {
    if (resolveImageProcessorId(preset)) return 'builtin';
    if (preset.id === 'split_component' || preset.id === 'cut_image') return 'builtin';
    return 'gen_image';
  }
  if (cat === 'generate_3d' || cat === 'generate_video') return 'builtin';
  if (cat === 'image_gen' || (cat as string) === 'image_gen') return 'gen_image';
  if (cat === 'text_llm' || (cat as string) === 'text_llm') return 'gen_text';
  return 'builtin';
}

export function capabilityUsesGenImageEngine(preset: CustomAppModule): boolean {
  return getCapabilityEngine(preset) === 'gen_image';
}

export function isImageProcessPreset(preset: CustomAppModule): boolean {
  if (preset.category === 'image_process') return true;
  return preset.category === 'image_to_image' && getCapabilityEngine(preset) === 'builtin';
}
