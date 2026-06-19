export type UsageRecordContext = {
  projectId?: string;
  workflowStepId?: string;
  assetId?: string;
  /** 工作流 pending task.id，同一任务下多次 AI 请求共用 */
  taskId?: string;
};

let activeContext: UsageRecordContext = {};

export function setUsageRecordContext(ctx: UsageRecordContext): void {
  activeContext = {
    projectId: ctx.projectId?.trim() || undefined,
    workflowStepId: ctx.workflowStepId?.trim() || undefined,
    assetId: ctx.assetId?.trim() || undefined,
    taskId: ctx.taskId?.trim() || undefined,
  };
}

export function clearUsageRecordContext(): void {
  activeContext = {};
}

export function peekUsageRecordContext(): UsageRecordContext {
  return { ...activeContext };
}
