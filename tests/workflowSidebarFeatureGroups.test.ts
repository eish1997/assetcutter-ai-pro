import { describe, expect, it } from 'vitest';
import { WORKFLOW_SIDEBAR_FEATURE_GROUPS } from '../components/workflow/workflowSidebarFeatureGroups';

describe('WORKFLOW_SIDEBAR_FEATURE_GROUPS', () => {
  it('includes storyboard flow placeholder under workflow group', () => {
    const group = WORKFLOW_SIDEBAR_FEATURE_GROUPS.find((g) => g.id === 'workflow');
    expect(group?.label).toBe('工作流组');
    expect(group?.items.some((item) => item.id === 'storyboard_flow' && item.label === '分镜流程')).toBe(true);
  });
});
