import { describe, expect, it } from 'vitest';

import { SET_ACTION_PREFIX } from '../components/workflow/workflowSectionUiConstants';
import {
  classifyWorkflowRunTaskBranch,
  WORKFLOW_SECTION_RUN_TASK_BRANCHES,
} from '../services/workflowRunTaskBranch';
import { WORKFLOW_SET_ACTION_PREFIX } from '../services/workflowSetActionPrefix';
import type { CustomAppModule } from '../types';

describe('workflowRunTaskBranch', () => {
  it('SET_ACTION_PREFIX 与 WORKFLOW_SET_ACTION_PREFIX 一致', () => {
    expect(SET_ACTION_PREFIX).toBe(WORKFLOW_SET_ACTION_PREFIX);
  });

  it('classify：能力集合 → branch_capability_set', () => {
    expect(
      classifyWorkflowRunTaskBranch({
        actionType: `${WORKFLOW_SET_ACTION_PREFIX}my-set`,
        module: undefined,
      })
    ).toBe('branch_capability_set');
  });

  it('classify：generate_3d 预设优先于普通 module', () => {
    const mod = { id: 'x', label: 'l', instruction: 'i', category: 'generate_3d' } as CustomAppModule;
    expect(classifyWorkflowRunTaskBranch({ actionType: 'x', module: mod })).toBe('branch_generate_3d');
  });

  it('classify：普通预设 → executeCapability', () => {
    const mod = {
      id: 'gen',
      label: 't',
      instruction: 'i',
      category: 'text_to_image',
    } as CustomAppModule;
    expect(classifyWorkflowRunTaskBranch({ actionType: 'gen', module: mod })).toBe('branch_preset_execute_capability');
  });

  it('classify：image_process + processor cut_image → branch_cut_image', () => {
    const mod = {
      id: 'my_cut_2x2',
      label: '切割 2*2',
      category: 'image_process',
      processor: 'cut_image',
      params: { cutMode: 'uniform', uniformRows: 2, uniformCols: 2 },
    } as CustomAppModule;
    expect(classifyWorkflowRunTaskBranch({ actionType: 'my_cut_2x2', module: mod })).toBe('branch_cut_image');
  });

  it('classify：无 module 的 cut_image', () => {
    expect(classifyWorkflowRunTaskBranch({ actionType: 'cut_image', module: undefined })).toBe(
      'branch_cut_image_no_module'
    );
  });

  it('classify：未知 action → fallback', () => {
    expect(classifyWorkflowRunTaskBranch({ actionType: 'unknown_action_xyz', module: undefined })).toBe(
      'branch_fallback_error'
    );
  });

  it('WORKFLOW_SECTION_RUN_TASK_BRANCHES 与 classify 顺序一致', () => {
    const sorted = [...WORKFLOW_SECTION_RUN_TASK_BRANCHES].sort((a, b) => a.order - b.order);
    expect(sorted.map((b) => b.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
