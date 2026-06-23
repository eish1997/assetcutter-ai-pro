import type { CorrelationContext } from '../../shared/observability/correlation';

let activeContext: CorrelationContext = {};

export function setCorrelationContext(ctx: CorrelationContext): void {
  activeContext = {
    correlationId: ctx.correlationId?.trim() || undefined,
    projectId: ctx.projectId?.trim() || undefined,
    assetId: ctx.assetId?.trim() || undefined,
    actionType: ctx.actionType?.trim() || undefined,
    auditEventId: ctx.auditEventId?.trim() || undefined,
    resultKey: ctx.resultKey?.trim() || undefined,
    registryId: ctx.registryId?.trim() || undefined,
    channelId: ctx.channelId?.trim() || undefined,
  };
}

export function clearCorrelationContext(): void {
  activeContext = {};
}

export function peekCorrelationContext(): CorrelationContext {
  return { ...activeContext };
}

/** @deprecated 使用 setCorrelationContext */
export function setUsageRecordContext(ctx: {
  projectId?: string;
  workflowStepId?: string;
  assetId?: string;
  taskId?: string;
}): void {
  setCorrelationContext({
    projectId: ctx.projectId,
    actionType: ctx.workflowStepId,
    assetId: ctx.assetId,
    correlationId: ctx.taskId,
  });
}

/** @deprecated 使用 clearCorrelationContext */
export function clearUsageRecordContext(): void {
  clearCorrelationContext();
}

/** @deprecated 使用 peekCorrelationContext */
export function peekUsageRecordContext(): {
  projectId?: string;
  workflowStepId?: string;
  assetId?: string;
  taskId?: string;
} {
  const ctx = peekCorrelationContext();
  return {
    projectId: ctx.projectId,
    workflowStepId: ctx.actionType,
    assetId: ctx.assetId,
    taskId: ctx.correlationId,
  };
}
