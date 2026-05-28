import type { CustomAppModule } from '../types';
import { isCutImageCapabilityPreset } from './capabilityProcessors/imageProcessProcessors';
import { WORKFLOW_SET_ACTION_PREFIX } from './workflowSetActionPrefix';

/** 与 `WorkflowSection.runTask` 判定顺序一致；勿随意改序。 */
export type WorkflowRunTaskBranchId =
  | 'branch_capability_set'
  | 'branch_generate_3d'
  | 'branch_preset_execute_capability'
  | 'branch_cut_image'
  | 'branch_cut_image_no_module'
  | 'branch_fallback_error';

export interface WorkflowSectionRunTaskBranch {
  readonly id: WorkflowRunTaskBranchId;
  readonly order: number;
  readonly conditionSummary: string;
  readonly handlerSummary: string;
}

export const WORKFLOW_SECTION_RUN_TASK_BRANCHES: readonly WorkflowSectionRunTaskBranch[] = [
  {
    id: 'branch_capability_set',
    order: 1,
    conditionSummary: '`actionType` 以 `WORKFLOW_SET_ACTION_PREFIX`（`set:`）开头',
    handlerSummary: '`executeCapabilitySet` → `capabilityExecutor`（多步；含文/图/视频等节点）',
  },
  {
    id: 'branch_generate_3d',
    order: 2,
    conditionSummary: '匹配预设存在且 `category === "generate_3d"`',
    handlerSummary: '`onAddGenerate3DJob`（由 `App` 注入 → `generate3d` / 网关，不经 `executeCapability`）',
  },
  {
    id: 'branch_preset_execute_capability',
    order: 3,
    conditionSummary: '匹配到能力预设 `module`，且非切割图片处理器',
    handlerSummary: '`executeCapability` → `capabilityExecutor` → `unifiedAiGateway`（含 `generate_video` 等）',
  },
  {
    id: 'branch_cut_image',
    order: 4,
    conditionSummary: '匹配到 `module` 且 `resolveImageProcessorId === "cut_image"`',
    handlerSummary: '由 `executePending` 专用切割路径处理（多图入组）；`runTask` 不应再调 `executeCapability`',
  },
  {
    id: 'branch_cut_image_no_module',
    order: 5,
    conditionSummary: '无 `module` 且 `actionType === "cut_image"`',
    handlerSummary: '本地切割路径，立即 `return { image: null }`（结果由其它逻辑落盘）',
  },
  {
    id: 'branch_fallback_error',
    order: 6,
    conditionSummary: '其余',
    handlerSummary: '`setAssetError` + 未能获得结果提示',
  },
];

/**
 * 根据 `actionType` 与其 `getModule` 结果分类，**含**能力集合（`set:` 前缀优先于 `module`）。
 * `WorkflowSection.runTask` 在解析输入图后调用，再 `switch` 分发。
 */
export function classifyWorkflowRunTaskBranch(params: {
  actionType: string;
  module: CustomAppModule | null | undefined;
}): WorkflowRunTaskBranchId {
  const { actionType, module } = params;
  if (actionType.startsWith(WORKFLOW_SET_ACTION_PREFIX)) {
    return 'branch_capability_set';
  }
  if (module?.category === 'generate_3d') {
    return 'branch_generate_3d';
  }
  if (module && isCutImageCapabilityPreset(module)) {
    return 'branch_cut_image';
  }
  if (module) {
    return 'branch_preset_execute_capability';
  }
  if (actionType === 'cut_image') {
    return 'branch_cut_image_no_module';
  }
  return 'branch_fallback_error';
}
