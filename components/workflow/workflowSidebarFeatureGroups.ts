/** 功能区侧栏：工作流类功能占位（非能力预设，后续接真实逻辑） */
export type WorkflowSidebarFeaturePlaceholder = {
  id: string;
  label: string;
  /** 悬停提示；占位块默认「功能开发中」 */
  hint?: string;
};

export type WorkflowSidebarFeatureGroup = {
  id: string;
  label: string;
  items: WorkflowSidebarFeaturePlaceholder[];
};

export const WORKFLOW_SIDEBAR_FEATURE_GROUPS: WorkflowSidebarFeatureGroup[] = [
  {
    id: 'workflow',
    label: '工作流组',
    items: [{ id: 'storyboard_flow', label: '分镜流程', hint: '功能开发中，敬请期待' }],
  },
];
