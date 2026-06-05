import type { CapabilityExecuteContext } from './capabilityExecutor';
import { appendWorkflowAuditEvent } from './workflowAuditEvents';

export const STORYBOARD_AUDIT_CODES = {
  GEN_SUCCESS: 'STORYBOARD_GEN_SUCCESS',
  GEN_FAILED: 'STORYBOARD_GEN_FAILED',
  LLM_SUCCESS: 'STORYBOARD_LLM_SUCCESS',
  LLM_FAILED: 'STORYBOARD_LLM_FAILED',
} as const;

export type StoryboardTaskOperation =
  | 'sheet_gen'
  | 'row_redraw'
  | 'collage_redraw'
  | 'feedback_redraw'
  | 'role_replace_row'
  | 'role_replace_collage'
  | 'bulk_normalize'
  | 'parse_text'
  | 'parse_bulk'
  | 'parse_row'
  | 'parse_batch'
  | 'optimize_text'
  | 'optimize_row'
  | 'vision_detect'
  | 'vision_split';

export function storyboardAssetIdFromCtx(ctx: CapabilityExecuteContext | undefined): string {
  return String(ctx?.storyboardAssetId || '').trim();
}

export function auditStoryboardTaskOutcome(args: {
  kind: 'gen' | 'llm';
  ok: boolean;
  assetId?: string;
  operation: StoryboardTaskOperation;
  message: string;
  detail?: Record<string, unknown>;
  rowId?: string;
  taskId?: string;
  level?: 'info' | 'warn' | 'error';
}): void {
  const assetId = String(args.assetId || '').trim();
  if (!assetId) return;

  const code = args.ok
    ? args.kind === 'gen'
      ? STORYBOARD_AUDIT_CODES.GEN_SUCCESS
      : STORYBOARD_AUDIT_CODES.LLM_SUCCESS
    : args.kind === 'gen'
      ? STORYBOARD_AUDIT_CODES.GEN_FAILED
      : STORYBOARD_AUDIT_CODES.LLM_FAILED;

  const level = args.level ?? (args.ok ? 'info' : 'warn');

  appendWorkflowAuditEvent({
    level,
    code,
    assetId,
    taskId: args.taskId,
    message: args.message,
    detail: {
      context: 'storyboard_table',
      operation: args.operation,
      ...(args.rowId ? { rowId: args.rowId } : {}),
      ...args.detail,
    },
  });
}

export async function runStoryboardLlmAudited<T>(
  ctx: CapabilityExecuteContext,
  operation: StoryboardTaskOperation,
  fn: () => Promise<T>,
  messages: {
    success: (result: T) => string;
    failure?: (err: unknown) => string;
    detail?: (result: T) => Record<string, unknown> | undefined;
    rowId?: string;
  }
): Promise<T> {
  const assetId = storyboardAssetIdFromCtx(ctx);
  try {
    const result = await fn();
    if (assetId) {
      auditStoryboardTaskOutcome({
        kind: 'llm',
        ok: true,
        assetId,
        operation,
        message: messages.success(result),
        rowId: messages.rowId,
        detail: messages.detail?.(result),
      });
    }
    return result;
  } catch (err) {
    if (assetId) {
      auditStoryboardTaskOutcome({
        kind: 'llm',
        ok: false,
        assetId,
        operation,
        rowId: messages.rowId,
        message:
          messages.failure?.(err) ??
          (err instanceof Error ? err.message : String(err || 'LLM 调用失败')),
        level: 'error',
      });
    }
    throw err;
  }
}

export function auditStoryboardGenFromCtx(
  ctx: CapabilityExecuteContext,
  operation: StoryboardTaskOperation,
  ok: boolean,
  message: string,
  extra?: { rowId?: string; taskId?: string; detail?: Record<string, unknown>; level?: 'info' | 'warn' | 'error' }
): void {
  auditStoryboardTaskOutcome({
    kind: 'gen',
    ok,
    assetId: storyboardAssetIdFromCtx(ctx),
    operation,
    message,
    rowId: extra?.rowId,
    taskId: extra?.taskId,
    detail: extra?.detail,
    level: extra?.level,
  });
}

export function resolveStoryboardCollageAuditOperation(
  args: { auditOperation?: StoryboardTaskOperation; feedbackRedraw?: boolean; rowCount: number }
): StoryboardTaskOperation {
  if (args.auditOperation) return args.auditOperation;
  if (args.feedbackRedraw) return 'feedback_redraw';
  if (args.rowCount > 1) return 'feedback_redraw';
  return 'collage_redraw';
}
