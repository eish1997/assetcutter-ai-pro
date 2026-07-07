/**
 * 工作流积分旁路：委托 aiBillingGate 路由规划（requiresPlatformCredits 取反）。
 */
import type { CustomAppModule, CapabilitySet } from '../types';
import {
  creditOverridesFromTaskLike,
  planCapabilityModuleRoutes,
  planCapabilitySetRoutes,
  planWorkflowActionRoutes,
  requiresPlatformCredits,
  resolveJobKindBillingStep,
  type CapabilityCreditOverrides,
} from './aiBillingGate';
import { classifyWorkflowRunTaskBranch } from './workflowRunTaskBranch';

export type { CapabilityCreditOverrides } from './aiBillingGate';
export { creditOverridesFromTaskLike } from './aiBillingGate';

/** 单能力预设是否全程走 BYOK（不走站点代付） */
export function proxyCreditsBypassedForCapabilityModule(
  module: CustomAppModule | null | undefined,
  overrides?: CapabilityCreditOverrides
): boolean {
  if (!module) return false;
  const steps = planCapabilityModuleRoutes(module, overrides);
  return steps.length > 0 && !requiresPlatformCredits(steps);
}

/** 能力集合内全部 AI 节点均 BYOK 时才旁路积分 */
export function proxyCreditsBypassedForCapabilitySet(
  set: CapabilitySet,
  presets: CustomAppModule[]
): boolean {
  const steps = planCapabilitySetRoutes(set, presets);
  return steps.length > 0 && !requiresPlatformCredits(steps);
}

/** 工作流 action：按实际 binding 判断是否旁路积分 */
export function proxyCreditsBypassedForWorkflowAction(
  actionType: string,
  module: CustomAppModule | null | undefined,
  opts?: {
    capabilitySet?: CapabilitySet | null;
    presets?: CustomAppModule[];
    overrides?: CapabilityCreditOverrides;
  }
): boolean {
  const steps = planWorkflowActionRoutes(actionType, module ?? null, opts);
  if (steps.length > 0) {
    return !requiresPlatformCredits(steps);
  }
  const branch = classifyWorkflowRunTaskBranch({ actionType, module: module ?? null });
  if (branch === 'branch_capability_set' && !opts?.capabilitySet) return false;
  return false;
}

/** 快捷栏：全部卡片均 BYOK 时旁路 */
export function proxyCreditsBypassedForQuickCompose(params: {
  mode: 'text' | 'image' | '3d';
  promptCards: ReadonlyArray<{ presetId: string }>;
  resolveModule: (presetId: string) => CustomAppModule | null | undefined;
}): boolean {
  if (params.promptCards.length === 0) {
    if (params.mode === '3d') {
      return !requiresPlatformCredits([resolveJobKindBillingStep('workflow_generate_3d')]);
    }
    return false;
  }
  for (const card of params.promptCards) {
    const mod = params.resolveModule(card.presetId);
    if (!mod) return false;
    if (!proxyCreditsBypassedForWorkflowAction(mod.id, mod)) return false;
  }
  return true;
}
