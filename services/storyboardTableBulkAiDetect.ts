import type { CustomAppModule } from '../types';
import { resolveTextModelForPreset } from './capabilityTextModel';
import type { CapabilityExecuteContext } from './capabilityExecutor';
import { auditStoryboardTaskOutcome, storyboardAssetIdFromCtx } from './storyboardTaskAuditEvents';
import { runStoryboardGatewayText } from './storyboardGatewayText';
import {
  STORYBOARD_BULK_LLM_REQUEST_OPTIONS,
  STORYBOARD_BULK_LLM_TIMEOUT_MS,
} from './storyboardTableBulkLlmConstants';
import {
  parseStoryboardBulkText,
  type StoryboardBulkParseResult,
  type StoryboardBulkTextMode,
} from './storyboardTableBulkImport';

export { STORYBOARD_BULK_LLM_REQUEST_OPTIONS, STORYBOARD_BULK_LLM_TIMEOUT_MS } from './storyboardTableBulkLlmConstants';

export const DEFAULT_STORYBOARD_BULK_NORMALIZE_INSTRUCTION = `你是分镜表导入预处理助手。用户会粘贴任意格式的文本。

请完成两步：
1. 判断输入是否为「分镜 / 镜头脚本文本」（可多镜；形式可以是表格、管道符列表、编号段落、场景描述混排等）。
2. 若是分镜文本，规范化为可被表格解析器读取的管道符格式；若不是，说明原因。

【不是分镜文本的例子】普通聊天、代码、技术文档、散文、会议纪要、与镜头无关的策划摘要等。

【规范化要求 — 仅 isStoryboard=true 时输出 normalizedText】
- 第一行必须是列名，用「 | 」（空格+竖线+空格）分隔。
- 从第二行起每行一镜，列数与表头一致，缺失项写「-」。
- 跳过章节/幕标题、统筹说明、重复表头行；只输出含合法镜头号的镜头行（如 01、021、SC01_SH002）。
- 列名根据原文实际维度选择，例如：镜头号、景别、角度、运镜、时长、画面内容、对白、音效、服化道、光影、备注 等；不要编造原文没有的列。
- 保留原文措辞，不要翻译、润色或合并不同维度。
- 时长保留原文单位（如 3.0s、24帧）。
- 不要输出 markdown 代码块。

只输出 JSON：
{
  "isStoryboard": true,
  "normalizedText": "镜头号 | 景别 | 时长 | 画面内容\\nSC01 | 远景 | 2.5s | 城市夜景"
}
或
{
  "isStoryboard": false,
  "reason": "这是普通对话，不是分镜脚本"
}`;

export type StoryboardBulkAiNormalizeResult =
  | {
      isStoryboard: true;
      normalizedText: string;
      parsed: StoryboardBulkParseResult;
      source: 'ai';
    }
  | {
      isStoryboard: false;
      reason: string;
      source: 'ai';
    };

type BulkAiNormalizeModelOutput = {
  isStoryboard?: boolean;
  reason?: string;
  normalizedText?: string;
};

export function normalizeBulkAiNormalizeOutput(raw: string): BulkAiNormalizeModelOutput {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    throw new Error('AI 返回非 JSON：' + String(e));
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('AI 返回 JSON 格式无效');
  }
  return obj as BulkAiNormalizeModelOutput;
}

export async function normalizeStoryboardBulkWithAi(
  text: string,
  preset: CustomAppModule,
  ctx: CapabilityExecuteContext,
  options?: { instruction?: string; mode?: StoryboardBulkTextMode; maxChars?: number }
): Promise<StoryboardBulkAiNormalizeResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { isStoryboard: false, reason: '请输入至少一行内容', source: 'ai' };
  }

  const sys =
    (options?.instruction || '').trim() || DEFAULT_STORYBOARD_BULK_NORMALIZE_INSTRUCTION;
  const maxChars = options?.maxChars ?? 12000;
  const body = `${sys}\n\n---\n\n${trimmed.slice(0, maxChars)}`;
  const label = preset.label || preset.id;
  ctx.onLog?.('info', `分镜表 · ${label} · AI 判定与规范化中…`);

  const assetId = storyboardAssetIdFromCtx(ctx);
  let raw: string;
  try {
    raw = await runStoryboardGatewayText({
      prompt: body,
      model: resolveTextModelForPreset(preset, ctx),
      ctx,
      operation: 'bulk_normalize',
      presetId: preset.id,
      presetLabel: label,
      requestOptions: STORYBOARD_BULK_LLM_REQUEST_OPTIONS,
    });
  } catch (err) {
    if (assetId) {
      auditStoryboardTaskOutcome({
        kind: 'llm',
        ok: false,
        assetId,
        operation: 'bulk_normalize',
        message: `分镜表 · 批量导入 AI 失败：${err instanceof Error ? err.message : String(err)}`,
        level: 'error',
        detail: { presetId: preset.id },
      });
    }
    throw err;
  }

  let payload: BulkAiNormalizeModelOutput;
  try {
    payload = normalizeBulkAiNormalizeOutput(raw);
  } catch (err) {
    if (assetId) {
      auditStoryboardTaskOutcome({
        kind: 'llm',
        ok: false,
        assetId,
        operation: 'bulk_normalize',
        message: `分镜表 · 批量导入 AI 返回无效：${err instanceof Error ? err.message : String(err)}`,
        level: 'error',
        detail: { presetId: preset.id },
      });
    }
    throw err;
  }
  if (payload.isStoryboard !== true) {
    const reason = String(payload.reason || '').trim() || '未识别为分镜脚本文本';
    ctx.onLog?.('warn', `分镜表 · AI 判定：非分镜文本（${reason}）`);
    if (assetId) {
      auditStoryboardTaskOutcome({
        kind: 'llm',
        ok: true,
        assetId,
        operation: 'bulk_normalize',
        message: `分镜表 · AI 判定：非分镜文本（${reason}）`,
        level: 'warn',
        detail: { presetId: preset.id, isStoryboard: false },
      });
    }
    return { isStoryboard: false, reason, source: 'ai' };
  }

  const normalizedText = String(payload.normalizedText || '').trim();
  if (!normalizedText) {
    if (assetId) {
      auditStoryboardTaskOutcome({
        kind: 'llm',
        ok: false,
        assetId,
        operation: 'bulk_normalize',
        message: '分镜表 · AI 未返回可解析的规范化表格',
        detail: { presetId: preset.id },
      });
    }
    return { isStoryboard: false, reason: 'AI 未返回可解析的规范化表格', source: 'ai' };
  }

  const mode = options?.mode ?? 'pipe';
  const parsed = parseStoryboardBulkText(normalizedText, mode);
  if (!parsed.rows.length) {
    if (assetId) {
      auditStoryboardTaskOutcome({
        kind: 'llm',
        ok: false,
        assetId,
        operation: 'bulk_normalize',
        message: parsed.errors[0] || '规范化结果未能解析为有效镜头',
        detail: { presetId: preset.id },
      });
    }
    return {
      isStoryboard: false,
      reason: parsed.errors[0] || '规范化结果未能解析为有效镜头',
      source: 'ai',
    };
  }

  ctx.onLog?.('info', `分镜表 · AI 规范化完成（${parsed.rows.length} 镜）`);
  if (assetId) {
    auditStoryboardTaskOutcome({
      kind: 'llm',
      ok: true,
      assetId,
      operation: 'bulk_normalize',
      message: `分镜表 · AI 规范化完成（${parsed.rows.length} 镜）`,
      detail: { presetId: preset.id, rowCount: parsed.rows.length },
    });
  }
  return { isStoryboard: true, normalizedText, parsed, source: 'ai' };
}

/** 本地规则可解析则直接返回；否则走 AI 判定 + 规范化（方案 B） */
export async function parseStoryboardBulkTextWithAiFallback(
  text: string,
  mode: StoryboardBulkTextMode,
  preset: CustomAppModule,
  ctx: CapabilityExecuteContext,
  options?: { forceAi?: boolean }
): Promise<
  | ({ source: 'local' } & StoryboardBulkParseResult)
  | ({ source: 'ai'; normalizedText: string } & StoryboardBulkParseResult)
> {
  if (!options?.forceAi) {
    const local = parseStoryboardBulkText(text, mode);
    if (local.rows.length) {
      return { ...local, source: 'local' };
    }
  }

  const ai = await normalizeStoryboardBulkWithAi(text, preset, ctx, { mode });
  if (ai.isStoryboard === false) {
    throw new Error(ai.reason);
  }
  return { ...ai.parsed, source: 'ai', normalizedText: ai.normalizedText };
}
