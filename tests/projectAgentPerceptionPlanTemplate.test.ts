import { describe, expect, it } from 'vitest';
import { formatPlanTemplate } from '../services/projectAgent/planTemplate';
import type { AgentPlannedTool } from '../types/projectAgent';
import type { ProjectAgentPerceptionContext } from '../types/runtimePerception';

describe('project agent perception plan template', () => {
  it('prefixes plan copy with runtime perception target', () => {
    const plan: AgentPlannedTool[] = [
      { toolId: 'run_plain_i2i', label: 'Image to image', args: { mainAssetId: 'asset-a' } },
    ];
    const perception: ProjectAgentPerceptionContext = {
      visibleSummary: 'Project: Launch | Surface: canvas | Selected 5 assets',
      targetSummary: 'Selected 5 assets',
      stale: false,
    };

    expect(formatPlanTemplate(plan, perception)).toBe(
      'Project: Launch | Surface: canvas | Selected 5 assets -> Plan: Image to image'
    );
  });

  it('sanitizes perception before including it in plan copy', () => {
    const plan: AgentPlannedTool[] = [{ toolId: 'run_plain_text', label: 'Text generation' }];
    const perception: ProjectAgentPerceptionContext = {
      visibleSummary: `C:\\Users\\Demo\\Project\\file.png data:image/png;base64,${'a'.repeat(120)}`,
      targetSummary: 'Current asset',
      stale: false,
    };

    const copy = formatPlanTemplate(plan, perception);
    expect(copy).toContain('[local-path]');
    expect(copy).toContain('[omitted-base64]');
    expect(copy).not.toContain('C:\\Users\\Demo');
    expect(copy).not.toContain('data:image/png;base64');
  });
});
