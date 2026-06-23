/** 四环（时间线 / 审计 / TaskEvents / Usage）共享关联键 */

export type CorrelationContext = {
  /** = WorkflowPendingTask.id；写入 usage meta.taskId */
  correlationId?: string;
  projectId?: string;
  assetId?: string;
  /** 预设/步骤 id；持久化字段仍为 workflow_step_id */
  actionType?: string;
  auditEventId?: string;
  resultKey?: string;
  registryId?: string;
  channelId?: string;
};
