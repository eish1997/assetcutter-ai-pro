import { describe, expect, it } from 'vitest';

import {
  WORKFLOW_AI_CARGO_ROWS,
  WORKFLOW_AI_PICK_EDGES,
  WORKFLOW_AI_PICK_NODES,
  WORKFLOW_SECTION_RUN_TASK_BRANCHES,
} from '../services/workflowAiPickIndex';

describe('workflowAiPickIndex', () => {
  it('货物大类表含关键 id（含 W0 即梦仓库行）', () => {
    expect(WORKFLOW_AI_CARGO_ROWS.length).toBeGreaterThanOrEqual(5);
    const ids = WORKFLOW_AI_CARGO_ROWS.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'cargo_text',
        'cargo_image',
        'cargo_video',
        'cargo_3d',
        'cargo_misc',
        'cargo_jimeng_image',
        'cargo_jimeng_video',
        'cargo_jimeng_dh',
      ])
    );
  });

  it('拣货图节点含闸门与供货商关键 id', () => {
    const ids = WORKFLOW_AI_PICK_NODES.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'unified_ai_gateway',
        'generate3d_module',
        'workflow_3d_companion_slots',
        'workflow_video_bridge',
        'gemini_proxy_fairness_chain',
        'model_registry_pick',
        'gemini_service_stack',
        'tripo_service',
        'tencent_service',
        'http_video_bridge_upstream',
        'local_companion_sam',
        'jimeng_warehouse',
        'jimeng_server_proxy',
        'volcengine_visual_upstream',
      ])
    );
  });

  it('每条边的 from/to 均指向已知节点', () => {
    const set = new Set(WORKFLOW_AI_PICK_NODES.map((n) => n.id));
    for (const e of WORKFLOW_AI_PICK_EDGES) {
      expect(set.has(e.from), `edge ${e.id} from`).toBe(true);
      expect(set.has(e.to), `edge ${e.id} to`).toBe(true);
    }
  });

  it('与 §1.4.3 一致的 capability_executor → unified_ai_gateway', () => {
    expect(WORKFLOW_AI_PICK_EDGES.some((e) => e.from === 'capability_executor' && e.to === 'unified_ai_gateway')).toBe(
      true
    );
  });

  it('本机智能分割：capability_executor → local_companion_sam', () => {
    expect(WORKFLOW_AI_PICK_EDGES.some((e) => e.from === 'capability_executor' && e.to === 'local_companion_sam')).toBe(
      true
    );
  });

  it('Gemini：unified_ai_gateway → gemini_proxy_fairness_chain → model_registry_pick → gemini_service_stack', () => {
    expect(WORKFLOW_AI_PICK_EDGES.some((e) => e.from === 'unified_ai_gateway' && e.to === 'gemini_proxy_fairness_chain')).toBe(
      true
    );
    expect(WORKFLOW_AI_PICK_EDGES.some((e) => e.from === 'gemini_proxy_fairness_chain' && e.to === 'model_registry_pick')).toBe(
      true
    );
    expect(WORKFLOW_AI_PICK_EDGES.some((e) => e.from === 'model_registry_pick' && e.to === 'gemini_service_stack')).toBe(
      true
    );
  });

  it('WorkflowSection.runTask 分支表顺序连续且含 generate_3d / executeCapability', () => {
    expect(WORKFLOW_SECTION_RUN_TASK_BRANCHES).toHaveLength(6);
    const orders = WORKFLOW_SECTION_RUN_TASK_BRANCHES.map((b) => b.order).sort((a, b) => a - b);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6]);
    const ids = WORKFLOW_SECTION_RUN_TASK_BRANCHES.map((b) => b.id);
    expect(ids).toContain('branch_generate_3d');
    expect(ids).toContain('branch_preset_execute_capability');
  });

  it('即梦：unified_ai_gateway → jimeng_warehouse → jimeng_server_proxy → volcengine', () => {
    expect(WORKFLOW_AI_PICK_EDGES.some((e) => e.from === 'unified_ai_gateway' && e.to === 'jimeng_warehouse')).toBe(
      true
    );
    expect(WORKFLOW_AI_PICK_EDGES.some((e) => e.from === 'jimeng_warehouse' && e.to === 'jimeng_server_proxy')).toBe(
      true
    );
    expect(
      WORKFLOW_AI_PICK_EDGES.some((e) => e.from === 'jimeng_server_proxy' && e.to === 'volcengine_visual_upstream')
    ).toBe(true);
    expect(WORKFLOW_AI_PICK_EDGES.some((e) => e.from === 'model_registry_pick' && e.to === 'jimeng_warehouse')).toBe(
      true
    );
  });
});
