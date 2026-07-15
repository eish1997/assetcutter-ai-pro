import type { CapabilityExecuteContext } from './capabilityExecutor';
import { runUnifiedTextGeneration } from './generation/runUnifiedGeneration';
import type { StoryboardTaskOperation } from './storyboardTaskAuditEvents';
import { storyboardAssetIdFromCtx } from './storyboardTaskAuditEvents';

export type RunStoryboardGatewayTextOptions = {
  prompt: string;
  model: string;
  ctx: CapabilityExecuteContext;
  operation: StoryboardTaskOperation;
  presetId?: string;
  presetLabel?: string;
  rowId?: string;
  requestOptions?: Record<string, unknown>;
};

export async function runStoryboardGatewayText(options: RunStoryboardGatewayTextOptions): Promise<string> {
  const prompt = String(options.prompt || '').trim();
  if (!prompt) throw new Error('分镜文本任务缺少提示词');
  const model = String(options.model || '').trim();
  if (!model) throw new Error('分镜文本任务缺少模型');
  const storyboardAssetId = storyboardAssetIdFromCtx(options.ctx);
  return runUnifiedTextGeneration({
    prompt,
    model,
    uiSource: `storyboard.${options.operation}`,
    assetContext: {
      ...(options.ctx.companionProjectId ? { projectId: options.ctx.companionProjectId } : {}),
      ...(storyboardAssetId ? { sourceAssetId: storyboardAssetId } : {}),
    },
    metadata: {
      storyboard: true,
      operation: options.operation,
      ...(storyboardAssetId ? { storyboardAssetId } : {}),
      ...(options.rowId ? { rowId: options.rowId } : {}),
      ...(options.presetId ? { presetId: options.presetId } : {}),
      ...(options.presetLabel ? { presetLabel: options.presetLabel } : {}),
      ...(options.requestOptions ? { requestOptions: options.requestOptions } : {}),
    },
    abortSignal: options.ctx.abortSignal,
  });
}
