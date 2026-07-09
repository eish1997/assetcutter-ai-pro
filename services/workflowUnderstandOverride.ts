/**
 * P2：能力执行是否走「理解」步 — 默认直发；仅无固定 instruction 且用户 opt-in 时才理解。
 */
import type { CustomAppModule } from '../types';

export function overrideSkipUnderstandFromUnderstandEnabled(
  understandEnabled: boolean | undefined
): boolean | undefined {
  if (typeof understandEnabled !== 'boolean') return undefined;
  return !understandEnabled;
}

/**
 * 是否运行理解步（Flash 文本）。
 * - 有 preset.instruction → 一律直发（即使用户开了「理解」）
 * - skipUnderstand / overrideSkipUnderstand true → 直发
 * - 仅无固定 instruction 且 overrideSkipUnderstand === false → 理解
 */
export function shouldRunCapabilityUnderstand(
  preset: Pick<CustomAppModule, 'instruction' | 'skipUnderstand'>,
  opts?: { overrideSkipUnderstand?: boolean; userText?: string }
): boolean {
  if (opts?.overrideSkipUnderstand === true || preset.skipUnderstand === true) return false;
  const presetInstruction = String(preset.instruction || '').trim();
  if (presetInstruction.length > 0) return false;
  if (opts?.overrideSkipUnderstand === false) return true;
  return false;
}
