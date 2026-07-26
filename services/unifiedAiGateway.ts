/**
 * **站点统一大模型出口**（配电箱）
 *
 * 产品/组件/hooks **应只 import 本文件**，不直接 import `geminiService` / `tripoService`；
 * 便于换供应商、加观测、做限流时在单点演进。实现委托 `geminiService.getClientForTask()` / `getAI()`（内部走 `pickBinding` + channel 凭证）。
 *
 * - **薄委托**：`workflowChat` / `workflowGenerateImage` 等与底层 API 一一对应，行为与原先一致。
 * - **直通再导出**：贴图、擂台、对话等同名函数从 `geminiService` 再导出，仅收敛 import 路径。
 * - **Tripo**：生 3D 任务 API 经本文件 re-export。
 * - **腾讯混元生 3D（ai3d）**：`**tencentService**` 全量再导出；UI/hooks 勿直连该文件（与 Tripo 同纪律）。
 * - **生视频**：`workflowGenerateVideo` **只走** AI Gateway Job（`aiGatewayVideoExecution`）。
 * - **即梦 Jimeng**：`workflowGenerateImageJimeng` / `workflowGenerateVideoJimeng` **只走** AI Gateway（`jimeng-visual`）。**`isJimengAvailable()`** 读 status API。
 * - **排障**：构建变量 **`VITE_DEBUG_UNIFIED_AI=1`** 时，`workflow*` 委托在控制台输出 **`[unified-ai]`** 行 + **结构化第二参数**（`provider`、`registryId`/`model`、失败时的 **`errorHint`** 启发式分类），默认关闭。
 * - **Gemini 代理公平限流**：代理返回 **`rate_limited` / `queue_overflow`** 时底层抛 **`AiWorkerProxyFairnessRejectedError`**（本文件再导出）；**`throwFairnessRejected`** 同步派发 **`ac:ai-worker-proxy-fairness-rejected`** 供根组件浮层提示。
 * - **工作流软提示**：凡经 **`runMeteredAiCall`** 的 **`workflow*`** 失败且启发式为限流/繁忙（且**非**公平拒绝类）时，节流派发 **`ac:unified-ai-soft-notice`**（见 **`unifiedAiSoftNotice.ts`**）；对话等经本文件 **`getDialogTextResponse`** 包装同样走 gate。
 *
 * @see docs/多模型可运营改造计划.md §3.6
 */

import {
  CAPABILITY_UNDERSTAND_RETRY_OPTIONS,
  DEFAULT_PROMPTS,
  dialogGenerateImage as dialogGenerateImageRaw,
  dialogGenerateImageMulti as dialogGenerateImageMultiRaw,
  getDialogTextResponse as getDialogTextResponseRaw,
  understandImageEditIntent as understandImageEditIntentRaw,
  getSiteAssistantResponse as getSiteAssistantResponseRaw,
  getSiteAssistantResponseStream as getSiteAssistantResponseStreamRaw,
  parseBoundingBoxJsonArrayFromModelText,
  parseJsonObjectFromModelText,
  buildStoryboardSheetStructureAnalysisPrompt,
  generatePBRTexture as generatePBRTextureRaw,
  type StoryboardSheetStructureAnalysisRaw,
  type GeminiRequestOptions,
} from "./geminiService";
import {
  startTencent3DProJob as startTencent3DProJobRaw,
  startTencent3DRapidJob as startTencent3DRapidJobRaw,
} from "./tencentService";
import { getEnabledChannels } from "./settingsStore";
import {
  WorkflowVideoNotAvailableError,
  type WorkflowVideoJobInput,
  type WorkflowVideoJobResult,
} from "./workflowVideoBridge";
import {
  createAndPollAiGatewayVideoJob,
  isAiGatewayVideoExecutionEnabled,
} from "./aiGatewayVideoExecution";
import {
  createAndPollAiGatewayJimengImageJob,
  createAndPollAiGatewayJimengVideoJob,
} from "./aiGatewayJimengExecution";
import {
  runUnifiedContentsTextGeneration,
  runUnifiedImageGeneration,
  runUnifiedVisionTextGeneration,
} from "./generation/runUnifiedGeneration";
import { DEFAULT_MODEL_TEXT } from "./modelRegistry/constants";
import { AiWorkerProxyFairnessRejectedError } from "./aiWorkerProxyFairnessError";
import { dispatchUnifiedAiSoftNotice, clipUnifiedAiNoticeMessage } from "./unifiedAiSoftNotice";
import { gateBeforeUpstream } from "./aiDispatchGate";
import { markCreditsProxyHeadersFromGate } from "./creditsProxyBridge";
import type { BillingDecision } from "../shared/billingDecision";
import { peekCorrelationContext } from "./observability/correlationContext";
import { isJimengAvailable as isJimengAvailableImpl } from "./jimeng/client";
import { JimengNotConfiguredError } from "./jimeng/errors";
import type { JimengSubmitInput } from "./jimeng/types";
import {
  createTripoTask as createTripoTaskImpl,
  getTripoTask as getTripoTaskImpl,
  waitTripoTaskDone as waitTripoTaskDoneImpl,
  type TripoCreateTaskInput,
} from "./tripoService";
import {
  creditsExceededUserMessage,
  isCreditsExceededError,
} from "../shared/credits";

/** 统一「活儿」标识（日志/可观测；与 `WorkflowAiJobKind` 同义保留别名） */
export type UnifiedAiJobKind =
  | "workflow_chat"
  | "workflow_understand"
  | "workflow_text_to_image"
  | "workflow_image_edit"
  | "workflow_generate_3d"
  | "workflow_generate_video"
  | "workflow_jimeng_image"
  | "workflow_jimeng_video";

/** @deprecated 请优先使用 `UnifiedAiJobKind` */
export type WorkflowAiJobKind = UnifiedAiJobKind;

function isViteDebugUnifiedAi(): boolean {
  try {
    return String(
      ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEBUG_UNIFIED_AI || "").trim()
    ) === "1";
  } catch {
    return false;
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Soft-notice hint for metered AI calls.
 * Slice 2: production path uses only server `failureReason` (plus typed local errors above the call site).
 * Message-string heuristics are intentionally removed — missing failureReason → "other".
 */
export function resolveUnifiedAiSoftHint(error?: unknown): "rate_limit" | "upstream_busy" | "auth_config" | "other" {
  const failureReason =
    error && typeof error === "object"
      ? ((error as { failureReason?: { stage?: string; code?: string; retryable?: boolean } }).failureReason ||
          (error as { body?: { failureReason?: { stage?: string; code?: string } } }).body?.failureReason)
      : undefined;
  if (!failureReason || typeof failureReason !== "object") return "other";
  if (failureReason.stage === "upstream") {
    if (/rate_limit|RATE_LIMITED|429/i.test(String(failureReason.code || ""))) return "rate_limit";
    return "upstream_busy";
  }
  if (failureReason.stage === "provider_key") return "auth_config";
  return "other";
}

/** @deprecated Use resolveUnifiedAiSoftHint; message arg ignored (kept for call-site compatibility during slice 2). */
function unifiedAiErrorHint(_message: string, error?: unknown): "rate_limit" | "upstream_busy" | "auth_config" | "other" {
  return resolveUnifiedAiSoftHint(error);
}

type UnifiedAiDebugFields = Record<string, string | undefined>;

function inferBillingRoleForKind(kind: UnifiedAiJobKind): "text" | "image" {
  if (
    kind === "workflow_text_to_image" ||
    kind === "workflow_image_edit" ||
    kind.startsWith("workflow_jimeng")
  ) {
    return "image";
  }
  return "text";
}

type RunMeteredAiCallParams = {
  kind: UnifiedAiJobKind;
  registryId?: string;
  role?: "text" | "image";
  generate3dProvider?: "tripo" | "tencent";
  hasTripoApiKey?: boolean;
  hasTencentCreds?: boolean;
  debugFields?: () => UnifiedAiDebugFields;
};

export type MeteredAiCallContext = {
  billingDecision: BillingDecision;
};

/**
 * 包装全部 metered AI 调用：upstream 前 `gateBeforeUpstream`；始终 try/catch；
 * 限流/繁忙类错误节流派发软提示；**`VITE_DEBUG_UNIFIED_AI=1`** 时额外打 `[unified-ai]` 控制台日志。
 */
async function runMeteredAiCall<T>(
  params: RunMeteredAiCallParams,
  fn: (ctx: MeteredAiCallContext) => Promise<T>
): Promise<T> {
  const kind = params.kind;
  const t0 = nowMs();
  const debug = isViteDebugUnifiedAi();
  const channels = getEnabledChannels().join(",");
  const fields = { channels, ...(params.debugFields?.() ?? {}) };
  let billingDecision: BillingDecision | undefined;
  let outcome: "success" | "failed" = "failed";
  try {
    const ctx = peekCorrelationContext();
    const registryId = (params.registryId ?? fields.registryId)?.trim();
    billingDecision = await gateBeforeUpstream({
      jobKind: kind,
      registryId: registryId || undefined,
      role: params.role ?? inferBillingRoleForKind(kind),
      generate3dProvider: params.generate3dProvider,
      hasTripoApiKey: params.hasTripoApiKey,
      hasTencentCreds: params.hasTencentCreds,
      scopeKey: ctx.correlationId,
    });
    const pr = billingDecision.platformReserve;
    if (pr?.proxyAdmissionHeaders && pr.estimatedCredits) {
      markCreditsProxyHeadersFromGate(pr.proxyAdmissionHeaders, pr.estimatedCredits);
    }
    const out = await fn({ billingDecision });
    outcome = "success";
    if (debug) console.info(`[unified-ai] ${kind} ok ${Math.round(nowMs() - t0)}ms`, fields);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errorHint =
      isCreditsExceededError(e)
        ? "credits_exceeded"
        : e instanceof AiWorkerProxyFairnessRejectedError
        ? e.status === 429 || e.code === "rate_limited"
          ? "rate_limit"
          : "upstream_busy"
        : unifiedAiErrorHint(msg, e);
    if (debug) {
      console.warn(`[unified-ai] ${kind} fail ${Math.round(nowMs() - t0)}ms`, { ...fields, errorHint }, msg);
    }
    if (isCreditsExceededError(e)) {
      dispatchUnifiedAiSoftNotice({
        kind: "credits_exceeded",
        message: creditsExceededUserMessage(),
        jobKind: kind,
      });
      throw new Error(creditsExceededUserMessage(), { cause: e });
    }
    if (!(e instanceof AiWorkerProxyFairnessRejectedError)) {
      if (errorHint === "rate_limit" || errorHint === "upstream_busy") {
        const headline =
          errorHint === "rate_limit" ? "上游或配额限流（非本站公平队列）" : "上游繁忙或暂时不可用（非队列硬顶）";
        dispatchUnifiedAiSoftNotice({
          kind: errorHint,
          message: `${headline}\n${clipUnifiedAiNoticeMessage(msg, 200)}`,
          jobKind: kind,
        });
      }
    }
    throw e;
  } finally {
    if (outcome === 'failed') {
      await billingDecision?.platformReserve?.release('failed');
    }
  }
}

// ----- 工具 / 常量 / 恢复（不经 gate 或 poll 免费） -----

export {
  DEFAULT_PROMPTS,
  mapRateLimitErrorText,
  normalizeApiErrorMessage,
  getGeminiImageBatchBoxSizeForCurrentProvider,
  buildStoryboardSheetStructureAnalysisPrompt,
  getEditPrompt,
  withGeminiRequestControl,
  extractAiWorkerProxyImageDataUrl,
  resumeGeminiAsyncJob,
  retryAllRecoverableGeminiJobs,
} from "./geminiService";

export { CAPABILITY_UNDERSTAND_RETRY_OPTIONS };
export type { GeminiRequestOptions };

/** @kind workflow_chat — 纯文字对话（经 gate → AI Gateway Job，C7） */
export async function getDialogTextResponse(
  contents: Parameters<typeof getDialogTextResponseRaw>[0],
  model?: Parameters<typeof getDialogTextResponseRaw>[1],
  options?: Parameters<typeof getDialogTextResponseRaw>[2]
): ReturnType<typeof getDialogTextResponseRaw> {
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    {
      kind: "workflow_chat",
      registryId: resolvedModel,
      role: "text",
      debugFields: () => ({ registryId: resolvedModel, textPath: "ai_gateway" }),
    },
    () =>
      runUnifiedContentsTextGeneration({
        contents: contents as Parameters<typeof runUnifiedContentsTextGeneration>[0]["contents"],
        model: resolvedModel || String(model || "").trim() || "gemini-2.5-flash",
        responseMimeType: options?.responseMimeType,
        uiSource: "unifiedAiGateway.getDialogTextResponse",
        abortSignal: options?.abortSignal,
        metadata: { source: "unifiedAiGateway.getDialogTextResponse" },
      })
  );
}

/** @kind workflow_understand — 理解生图意图（经 gate → AI Gateway Job，C7；无浏览器 Key fallback） */
export async function understandImageEditIntent(
  imageBase64: Parameters<typeof understandImageEditIntentRaw>[0],
  userPrompt: Parameters<typeof understandImageEditIntentRaw>[1],
  model?: Parameters<typeof understandImageEditIntentRaw>[2],
  customPrompt?: Parameters<typeof understandImageEditIntentRaw>[3],
  options?: Parameters<typeof understandImageEditIntentRaw>[4]
): ReturnType<typeof understandImageEditIntentRaw> {
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    {
      kind: "workflow_understand",
      registryId: resolvedModel,
      role: "text",
      debugFields: () => ({ registryId: resolvedModel, textPath: "ai_gateway" }),
    },
    async () => {
      const systemPrompt = customPrompt || DEFAULT_PROMPTS.dialog_understand;
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        {
          text: `User request: ${userPrompt}\n\nOutput only a valid JSON object with "instruction" (required), optional "summary", and "shouldGenerateImage" (required, true only when user wants to edit/generate a new image):`,
        },
      ];
      const images = Array.isArray(imageBase64)
        ? imageBase64.filter(Boolean)
        : imageBase64
          ? [imageBase64]
          : [];
      for (let i = images.length - 1; i >= 0; i -= 1) {
        const raw = String(images[i] || "").trim();
        if (!raw) continue;
        const dataUrl = raw.startsWith("data:")
          ? raw
          : `data:image/png;base64,${raw.replace(/\s+/g, "")}`;
        const matched = dataUrl.match(/^data:([^;,]+);base64,(.+)$/i);
        if (matched?.[2]) {
          parts.unshift({
            inlineData: {
              mimeType: matched[1] || "image/png",
              data: matched[2].replace(/\s+/g, ""),
            },
          });
        }
      }
      const raw = await runUnifiedContentsTextGeneration({
        contents: [{ role: "user", parts }],
        model: resolvedModel || String(model || "").trim() || "gemini-2.5-flash",
        systemInstruction: systemPrompt,
        uiSource: "unifiedAiGateway.understandImageEditIntent",
        abortSignal: options?.abortSignal,
        metadata: { source: "unifiedAiGateway.understandImageEditIntent" },
      });
      try {
        const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const obj = JSON.parse(cleaned);
        const instruction = typeof obj.instruction === "string" ? obj.instruction : raw;
        const shouldGenerateImage = obj.shouldGenerateImage === true;
        return { instruction, summary: obj.summary, shouldGenerateImage };
      } catch {
        return { instruction: raw, shouldGenerateImage: false };
      }
    }
  );
}

/** @kind workflow_text_to_image | workflow_image_edit — 对话生图（经 gate） */
export async function dialogGenerateImage(
  imageBase64: Parameters<typeof dialogGenerateImageRaw>[0],
  instruction: Parameters<typeof dialogGenerateImageRaw>[1],
  model?: Parameters<typeof dialogGenerateImageRaw>[2],
  options?: Parameters<typeof dialogGenerateImageRaw>[3],
  customSystemPrompt?: Parameters<typeof dialogGenerateImageRaw>[4],
  abortSignal?: Parameters<typeof dialogGenerateImageRaw>[5],
  requestOptions?: Parameters<typeof dialogGenerateImageRaw>[6]
): ReturnType<typeof dialogGenerateImageRaw> {
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    {
      kind: "workflow_text_to_image",
      registryId: resolvedModel,
      role: "image",
      debugFields: () => ({
        registryId: resolvedModel,
        imagePath: "ai_gateway",
      }),
    },
    async ({ billingDecision }) => {
      const estimatedCredits = Number(billingDecision.platformReserve?.estimatedCredits || 134);
      return runUnifiedImageGeneration({
        prompt: instruction,
        model: resolvedModel || String(model || "").trim() || "gemini-2.5-flash-image",
        registryId: resolvedModel,
        canonicalModelId: resolvedModel,
        referenceImages: imageBase64 ? [imageBase64] : [],
        imageOptions: options,
        systemInstruction: customSystemPrompt,
        uiSource: "unifiedAiGateway.dialogGenerateImage",
        estimatedCredits,
        abortSignal,
        metadata: {
          source: "unifiedAiGateway.dialogGenerateImage",
        },
      });
    }
  );
}

const SITE_ASSISTANT_SYSTEM = `You are the in-app assistant for AssetCutter AI Pro, a web app for intelligent asset production. You help users with:
- How to use features: 工作流 (compose / generate), 贴图修缝 / 生成贴图, 生成3D, 能力预设, 提示词擂台, 设置.
- Troubleshooting: e.g. "贴图修缝" needs Python backend or Pyodide; 生成贴图 / 工作流生图 go through the platform AI Gateway (operator Key pool in Admin).
- Other questions about the product. Reply in the same language as the user. Be concise and helpful.`;

/** @kind workflow_chat — 网站助手（经 gate → AI Gateway Job，C8） */
export async function getSiteAssistantResponse(
  userMessage: Parameters<typeof getSiteAssistantResponseRaw>[0],
  history?: Parameters<typeof getSiteAssistantResponseRaw>[1],
  model?: Parameters<typeof getSiteAssistantResponseRaw>[2],
  options?: Parameters<typeof getSiteAssistantResponseRaw>[3]
): ReturnType<typeof getSiteAssistantResponseRaw> {
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    {
      kind: "workflow_chat",
      registryId: resolvedModel,
      role: "text",
      debugFields: () => ({ registryId: resolvedModel, textPath: "ai_gateway" }),
    },
    () => {
      const contents = [
        ...(history || []).map((m) => ({
          role: m.role as "user" | "model",
          parts: [{ text: m.text }],
        })),
        { role: "user" as const, parts: [{ text: (userMessage || "").trim() || "(empty)" }] },
      ];
      return runUnifiedContentsTextGeneration({
        contents,
        model: resolvedModel || String(model || "").trim() || "gemini-2.5-flash",
        systemInstruction: SITE_ASSISTANT_SYSTEM,
        uiSource: "unifiedAiGateway.getSiteAssistantResponse",
        abortSignal: options?.abortSignal,
        metadata: { source: "unifiedAiGateway.getSiteAssistantResponse" },
      });
    }
  );
}

/** @kind workflow_chat — 网站助手流式（经 gate；Gateway 无流式则整段回调） */
export async function getSiteAssistantResponseStream(
  userMessage: Parameters<typeof getSiteAssistantResponseStreamRaw>[0],
  history: Parameters<typeof getSiteAssistantResponseStreamRaw>[1],
  onChunk: Parameters<typeof getSiteAssistantResponseStreamRaw>[2],
  model?: Parameters<typeof getSiteAssistantResponseStreamRaw>[3],
  options?: Parameters<typeof getSiteAssistantResponseStreamRaw>[4]
): ReturnType<typeof getSiteAssistantResponseStreamRaw> {
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    {
      kind: "workflow_chat",
      registryId: resolvedModel,
      role: "text",
      debugFields: () => ({ registryId: resolvedModel, textPath: "ai_gateway" }),
    },
    async () => {
      const contents = [
        ...(history || []).map((m) => ({
          role: m.role as "user" | "model",
          parts: [{ text: m.text }],
        })),
        { role: "user" as const, parts: [{ text: (userMessage || "").trim() || "(empty)" }] },
      ];
      const full = await runUnifiedContentsTextGeneration({
        contents,
        model: resolvedModel || String(model || "").trim() || "gemini-2.5-flash",
        systemInstruction: SITE_ASSISTANT_SYSTEM,
        uiSource: "unifiedAiGateway.getSiteAssistantResponseStream",
        abortSignal: options?.abortSignal,
        metadata: { source: "unifiedAiGateway.getSiteAssistantResponseStream" },
      });
      onChunk(full);
      return full;
    }
  );
}

// ----- 命名委托（工作流/能力执行器沿用 workflow* 名） -----

/** @kind workflow_chat */
export async function workflowChat(
  contents: Parameters<typeof getDialogTextResponseRaw>[0],
  model?: Parameters<typeof getDialogTextResponseRaw>[1],
  options?: Parameters<typeof getDialogTextResponseRaw>[2]
): ReturnType<typeof getDialogTextResponse> {
  return getDialogTextResponse(contents, model, options);
}

/** @kind workflow_understand */
export async function workflowUnderstandForImageGen(
  imageBase64: Parameters<typeof understandImageEditIntentRaw>[0],
  userPrompt: Parameters<typeof understandImageEditIntentRaw>[1],
  model?: Parameters<typeof understandImageEditIntentRaw>[2],
  customPrompt?: Parameters<typeof understandImageEditIntentRaw>[3],
  options?: Parameters<typeof understandImageEditIntentRaw>[4]
): ReturnType<typeof understandImageEditIntent> {
  return understandImageEditIntent(imageBase64, userPrompt, model, customPrompt, options);
}

/** @kind workflow_text_to_image | workflow_image_edit */
export async function workflowGenerateImage(
  imageBase64: Parameters<typeof dialogGenerateImageRaw>[0],
  instruction: Parameters<typeof dialogGenerateImageRaw>[1],
  model?: Parameters<typeof dialogGenerateImageRaw>[2],
  options?: Parameters<typeof dialogGenerateImageRaw>[3],
  customSystemPrompt?: Parameters<typeof dialogGenerateImageRaw>[4],
  abortSignal?: Parameters<typeof dialogGenerateImageRaw>[5],
  requestOptions?: Parameters<typeof dialogGenerateImageRaw>[6]
): ReturnType<typeof dialogGenerateImage> {
  return dialogGenerateImage(
    imageBase64,
    instruction,
    model,
    options,
    customSystemPrompt,
    abortSignal,
    requestOptions
  );
}

/** @kind workflow_image_edit */
export async function workflowGenerateImageMultiRefs(
  imagesBase64: Parameters<typeof dialogGenerateImageMulti>[0],
  instruction: Parameters<typeof dialogGenerateImageMulti>[1],
  model?: Parameters<typeof dialogGenerateImageMulti>[2],
  options?: Parameters<typeof dialogGenerateImageMulti>[3],
  abortSignal?: Parameters<typeof dialogGenerateImageMulti>[4],
  requestOptions?: Parameters<typeof dialogGenerateImageMulti>[5]
): ReturnType<typeof dialogGenerateImageMulti> {
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    {
      kind: "workflow_image_edit",
      registryId: resolvedModel,
      role: "image",
      debugFields: () => ({
        registryId: resolvedModel,
        refImageCount: String(Array.isArray(imagesBase64) ? imagesBase64.length : 0),
        imagePath: "ai_gateway",
      }),
    },
    async ({ billingDecision }) => {
      const estimatedCredits = Number(billingDecision.platformReserve?.estimatedCredits || 134);
      return runUnifiedImageGeneration({
        prompt: instruction,
        model: resolvedModel || String(model || "").trim() || "gemini-2.5-flash-image",
        registryId: resolvedModel,
        canonicalModelId: resolvedModel,
        referenceImages: Array.isArray(imagesBase64) ? imagesBase64 : [],
        imageOptions: options,
        uiSource: "unifiedAiGateway.workflowGenerateImageMultiRefs",
        estimatedCredits,
        abortSignal,
        metadata: {
          source: "unifiedAiGateway.workflowGenerateImageMultiRefs",
          referenceImageCount: Array.isArray(imagesBase64) ? imagesBase64.length : 0,
        },
      });
    }
  );
}

function toVisionDataUrl(base64Image: string): string {
  const raw = String(base64Image || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  const payload = raw.includes(",") ? raw.split(",")[1] || raw : raw;
  return `data:image/jpeg;base64,${payload.replace(/\s+/g, "")}`;
}

function abortSignalFromGeminiOptions(options?: GeminiRequestOptions): AbortSignal | undefined {
  const anyOpts = options as { signal?: AbortSignal; abortSignal?: AbortSignal } | undefined;
  return anyOpts?.abortSignal || anyOpts?.signal;
}

/**
 * @kind workflow_chat — 单图物体检测（D5/D6：AI Gateway text Job，Admin Jobs 可见）
 */
export async function detectObjectsInImage(
  base64Image: string,
  model?: string,
  customPrompt?: string,
  options?: GeminiRequestOptions
): Promise<
  Array<{ id: string; label: string; ymin: number; xmin: number; ymax: number; xmax: number }>
> {
  const resolvedModel = model != null && String(model).trim() !== "" ? String(model).trim() : DEFAULT_MODEL_TEXT;
  const prompt = customPrompt || DEFAULT_PROMPTS.detect_single;
  const dataUrl = toVisionDataUrl(base64Image);
  if (!dataUrl) throw new Error("缺少检测图片");
  return runMeteredAiCall(
    { kind: "workflow_chat", registryId: resolvedModel, role: "text", debugFields: () => ({ registryId: resolvedModel }) },
    async () => {
      const text = await runUnifiedVisionTextGeneration({
        prompt,
        model: resolvedModel,
        images: [dataUrl],
        responseMimeType: "application/json",
        uiSource: "capability.detect_objects",
        metadata: { detectObjects: true },
        abortSignal: abortSignalFromGeminiOptions(options),
      });
      const results = parseBoundingBoxJsonArrayFromModelText(text || "");
      return results.map((r) => {
        const box = r as { id: string; label: string; box_2d: number[] };
        return {
          id: box.id,
          label: box.label,
          ymin: box.box_2d[0],
          xmin: box.box_2d[1],
          ymax: box.box_2d[2],
          xmax: box.box_2d[3],
        };
      });
    }
  );
}

/**
 * @kind workflow_understand — 描述图片主体（D5/D6：AI Gateway text Job）
 */
export async function describeImageSubject(
  base64Image: string,
  model?: string,
  customPrompt?: string,
  options?: GeminiRequestOptions
): Promise<string> {
  const resolvedModel = model != null && String(model).trim() !== "" ? String(model).trim() : DEFAULT_MODEL_TEXT;
  const prompt = customPrompt || DEFAULT_PROMPTS.describe_subject;
  const dataUrl = toVisionDataUrl(base64Image);
  if (!dataUrl) throw new Error("缺少描述图片");
  return runMeteredAiCall(
    { kind: "workflow_understand", registryId: resolvedModel, role: "text", debugFields: () => ({ registryId: resolvedModel }) },
    async () => {
      const text = await runUnifiedVisionTextGeneration({
        prompt,
        model: resolvedModel,
        images: [dataUrl],
        uiSource: "capability.describe_subject",
        metadata: { describeSubject: true },
        abortSignal: abortSignalFromGeminiOptions(options),
      });
      const raw = String(text || "").trim();
      if (!raw) throw new Error("Empty subject description");
      return raw.replace(/\n+/g, " ").trim();
    }
  );
}

function toPbrDataUrl(base64: string): string {
  const raw = String(base64 || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  const payload = raw.includes(",") ? raw.split(",")[1] || raw : raw;
  return `data:image/png;base64,${payload.replace(/\s+/g, "")}`;
}

/** @kind workflow_image_edit — PBR 贴图生成（经 gate → AI Gateway Job，C8） */
export async function generatePBRTexture(
  functionalMaps: Parameters<typeof generatePBRTextureRaw>[0],
  prompt: Parameters<typeof generatePBRTextureRaw>[1],
  targetType: Parameters<typeof generatePBRTextureRaw>[2],
  baseColorMap?: Parameters<typeof generatePBRTextureRaw>[3],
  options?: Parameters<typeof generatePBRTextureRaw>[4]
): ReturnType<typeof generatePBRTextureRaw> {
  const modelId = "gemini-2.5-flash-image";
  return runMeteredAiCall(
    {
      kind: "workflow_image_edit",
      registryId: modelId,
      role: "image",
      debugFields: () => ({ registryId: modelId, imagePath: "ai_gateway" }),
    },
    async ({ billingDecision }) => {
      const refs: string[] = [];
      for (const map of functionalMaps || []) {
        const url = toPbrDataUrl(String(map?.base64 || ""));
        if (url) refs.push(url);
      }
      if (baseColorMap?.base64) {
        const url = toPbrDataUrl(String(baseColorMap.base64));
        if (url) refs.push(url);
      }
      const systemInstruction =
        targetType === "BASE_COLOR"
          ? `You are a world-class 3D texture artist expert in PBR (Physically Based Rendering) workflows.
Based on the provided functional maps (AO, Curvature, WS Normal, Position), generate a high-quality, hyper-realistic BASE COLOR (Albedo) map.
Requirements:
1. MUST follow the user requirement: ${prompt}.
2. MUST be flat lighting: No baked-in shadows, no 3D lighting, no directional light.
3. MUST be PBR compliant (Albedo should represent surface color only).
4. High detail and resolution suitable for modern game engines.
5. Output ONLY the image.`
          : `You are a world-class 3D texture artist.
Generate a ${targetType} map for a PBR workflow based on the provided Base Color and functional maps.
If generating Roughness: Darker values are smooth/shiny, lighter are rough/matte.
If generating Metallic: Grayscale where white is metal, black is non-metal.
Output ONLY the image.`;
      const mapTypes = (functionalMaps || [])
        .map((m) => String(m?.type || "").trim())
        .filter(Boolean)
        .join(", ");
      const userPrompt = [
        `Generate a PBR ${targetType} texture map.`,
        `User requirement: ${prompt}`,
        mapTypes ? `Functional map types provided: ${mapTypes}.` : "",
        baseColorMap?.base64 ? `A Base Color reference map is included among the reference images.` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return runUnifiedImageGeneration({
        prompt: userPrompt,
        model: modelId,
        registryId: modelId,
        canonicalModelId: modelId,
        referenceImages: refs,
        imageOptions: { aspectRatio: "1:1" },
        systemInstruction,
        uiSource: "unifiedAiGateway.generatePBRTexture",
        estimatedCredits: Number(billingDecision.platformReserve?.estimatedCredits || 134),
        abortSignal: options?.abortSignal,
        metadata: {
          source: "unifiedAiGateway.generatePBRTexture",
          targetType,
        },
      });
    }
  );
}

function arenaWriterSystemPrompt(options?: GeminiRequestOptions): string {
  const fromOpt =
    options?.arenaPromptWriter?.trim() ||
    options?.arenaPromptAb?.trim() ||
    options?.arenaPromptAbN?.trim();
  const base = (fromOpt || DEFAULT_PROMPTS.arena_writer).trim();
  return base || DEFAULT_PROMPTS.arena_writer;
}

function stripJsonFence(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

async function arenaTextViaGateway(args: {
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
  model?: string;
  uiSource: string;
  abortSignal?: AbortSignal;
  responseMimeType?: string;
}): Promise<string> {
  const model = String(args.model || "").trim() || DEFAULT_MODEL_TEXT;
  return runUnifiedContentsTextGeneration({
    contents: args.contents,
    model,
    responseMimeType: args.responseMimeType,
    uiSource: args.uiSource,
    abortSignal: args.abortSignal,
    metadata: { source: args.uiSource },
  });
}

/** @kind workflow_chat — 擂台 A/B 提示词（经 gate → AI Gateway Job；不经浏览器 Vertex 同步代理） */
export async function generateArenaABPrompts(
  userDescription: string,
  model?: string,
  options?: GeminiRequestOptions
): Promise<{ reasoning?: string; promptA: string; promptB: string; rawResponse?: string }> {
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    {
      kind: "workflow_chat",
      registryId: resolvedModel,
      role: "text",
      debugFields: () => ({ registryId: resolvedModel, textPath: "ai_gateway" }),
    },
    async () => {
      const sysAb = arenaWriterSystemPrompt(options);
      const raw = await arenaTextViaGateway({
        contents: [
          {
            role: "user",
            parts: [
              { text: sysAb },
              {
                text: `User description: ${(userDescription || "").trim().slice(0, 500)}\n\nN = 2. Output exactly 2 prompts (promptA, promptB). Important: These prompts will be sent to the image model together with the user's uploaded image. Ensure each prompt is an instruction to modify or transform that image (not a standalone description of a new scene).`,
              },
            ],
          },
        ],
        model: resolvedModel,
        uiSource: "unifiedAiGateway.generateArenaABPrompts",
        abortSignal: options?.abortSignal,
        responseMimeType: "application/json",
      });
      try {
        const cleaned = stripJsonFence(raw);
        const obj = JSON.parse(cleaned);
        const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim() : undefined;
        const promptA = typeof obj.promptA === "string" ? obj.promptA.trim() : "";
        const promptB = typeof obj.promptB === "string" ? obj.promptB.trim() : "";
        if (!promptA || !promptB) throw new Error("Missing promptA or promptB");
        return { reasoning, promptA, promptB, rawResponse: raw };
      } catch (e) {
        const fallback = (raw || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
        if (fallback.length >= 2) return { promptA: fallback[0], promptB: fallback[1], rawResponse: raw };
        throw new Error("Failed to parse arena A/B prompts: " + String(e));
      }
    }
  );
}

/** @kind workflow_chat — 擂台提示词（经 gate → AI Gateway Job） */
export async function generateArenaPrompts(
  userDescription: string,
  count: 2 | 3 | 4,
  model?: string,
  options?: GeminiRequestOptions
): Promise<{ reasoning?: string; prompts: string[]; rawResponse?: string }> {
  if (count === 2) {
    const out = await generateArenaABPrompts(userDescription, model, options);
    return { reasoning: out.reasoning, prompts: [out.promptA, out.promptB], rawResponse: out.rawResponse };
  }
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    {
      kind: "workflow_chat",
      registryId: resolvedModel,
      role: "text",
      debugFields: () => ({ registryId: resolvedModel, textPath: "ai_gateway" }),
    },
    async () => {
      const sysWriter = arenaWriterSystemPrompt(options);
      const raw = await arenaTextViaGateway({
        contents: [
          {
            role: "user",
            parts: [
              { text: sysWriter },
              {
                text: `User description: ${(userDescription || "").trim().slice(0, 500)}\n\nN = ${count}. Output exactly ${count} prompts (promptA, promptB${count >= 3 ? ", promptC" : ""}${count >= 4 ? ", promptD" : ""}). Important: These prompts will be sent to the image model together with the user's uploaded image; ensure each prompt is an instruction to modify or transform that image (not a standalone description of a new scene).`,
              },
            ],
          },
        ],
        model: resolvedModel,
        uiSource: "unifiedAiGateway.generateArenaPrompts",
        abortSignal: options?.abortSignal,
        responseMimeType: "application/json",
      });
      try {
        const cleaned = stripJsonFence(raw);
        const obj = JSON.parse(cleaned);
        const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim() : undefined;
        const prompts: string[] = [
          obj.promptA,
          obj.promptB,
          count >= 3 && obj.promptC ? obj.promptC : null,
          count >= 4 && obj.promptD ? obj.promptD : null,
        ]
          .filter(Boolean)
          .map((p: string) => (typeof p === "string" ? p : "").trim());
        if (prompts.length !== count) throw new Error(`Expected ${count} prompts, got ${prompts.length}`);
        return { reasoning, prompts, rawResponse: raw };
      } catch (e) {
        const fallback = (raw || "")
          .split(/\n+/)
          .map((s: string) => s.trim())
          .filter(Boolean)
          .slice(0, count);
        if (fallback.length >= count) return { prompts: fallback, rawResponse: raw };
        throw new Error("Failed to parse arena N prompts: " + String(e));
      }
    }
  );
}

/** @kind workflow_chat — 擂台优化败者（经 gate → AI Gateway Job） */
export async function optimizeLoserPrompt(
  winnerPrompt: string,
  loserPrompt: string,
  userDescription?: string,
  model?: string,
  allPreviousPrompts?: string[],
  userReportedGaps?: string[],
  winnerStrength?: string,
  loserRemark?: string,
  options?: GeminiRequestOptions
): Promise<{ reasoning?: string; prompt: string; rawResponse?: string }> {
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    {
      kind: "workflow_chat",
      registryId: resolvedModel,
      role: "text",
      debugFields: () => ({ registryId: resolvedModel, textPath: "ai_gateway" }),
    },
    async () => {
      const userText = [
        `Winner prompt (user preferred): ${winnerPrompt}`,
        `Loser prompt (to improve): ${loserPrompt}`,
        userDescription ? `Original user intent: ${userDescription}` : "",
        allPreviousPrompts && allPreviousPrompts.length > 0
          ? `Other prompts already in this arena (avoid repeating, use for context):\n${allPreviousPrompts.map((p, i) => `[${i + 1}] ${p}`).join("\n")}`
          : "",
        userReportedGaps && userReportedGaps.length > 0
          ? `User-reported gaps in the loser (address or avoid these when improving): ${userReportedGaps.join(", ")}`
          : "",
        winnerStrength && winnerStrength.trim()
          ? `User-reported strength of the winner (preserve or learn from): ${winnerStrength.trim()}`
          : "",
        loserRemark && loserRemark.trim()
          ? `User-reported remark about the loser (one sentence, address when improving): ${loserRemark.trim()}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const sysOpt =
        (options?.arenaPromptOptimizeLoser ?? DEFAULT_PROMPTS.arena_optimize_loser).trim() ||
        DEFAULT_PROMPTS.arena_optimize_loser;
      const raw = await arenaTextViaGateway({
        contents: [{ role: "user", parts: [{ text: sysOpt }, { text: userText }] }],
        model: resolvedModel,
        uiSource: "unifiedAiGateway.optimizeLoserPrompt",
        abortSignal: options?.abortSignal,
        responseMimeType: "application/json",
      });
      try {
        const cleaned = stripJsonFence(raw);
        const obj = JSON.parse(cleaned);
        const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim() : undefined;
        const prompt = (typeof obj.prompt === "string" ? obj.prompt : raw)
          .replace(/^["']|["']$/g, "")
          .trim()
          .slice(0, 2000);
        if (!prompt) throw new Error("Missing prompt in response");
        return { reasoning, prompt, rawResponse: raw };
      } catch (e) {
        throw new Error("Failed to parse optimize-loser response: " + String(e));
      }
    }
  );
}

/** @kind workflow_chat — 擂台新挑战者（经 gate → AI Gateway Job） */
export async function generateNewChallenger(
  userIntent: string,
  championPrompt: string,
  allPreviousPrompts: string[],
  model?: string,
  options?: GeminiRequestOptions
): Promise<{ reasoning?: string; prompt: string; rawResponse?: string }> {
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    {
      kind: "workflow_chat",
      registryId: resolvedModel,
      role: "text",
      debugFields: () => ({ registryId: resolvedModel, textPath: "ai_gateway" }),
    },
    async () => {
      const userText = [
        `Original user intent: ${userIntent}`,
        `Current champion (winner) prompt: ${championPrompt}`,
        allPreviousPrompts.length > 0
          ? `All other prompts already in this arena (be distinct from these):\n${allPreviousPrompts.map((p, i) => `[${i + 1}] ${p}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const sysNc =
        (options?.arenaPromptNewChallenger ?? DEFAULT_PROMPTS.arena_new_challenger).trim() ||
        DEFAULT_PROMPTS.arena_new_challenger;
      const raw = await arenaTextViaGateway({
        contents: [{ role: "user", parts: [{ text: sysNc }, { text: userText }] }],
        model: resolvedModel,
        uiSource: "unifiedAiGateway.generateNewChallenger",
        abortSignal: options?.abortSignal,
        responseMimeType: "application/json",
      });
      try {
        const cleaned = stripJsonFence(raw || "");
        const obj = JSON.parse(cleaned);
        const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim() : undefined;
        const prompt = (typeof obj.prompt === "string" ? obj.prompt : raw)
          .replace(/^["']|["']$/g, "")
          .trim()
          .slice(0, 2000);
        if (!prompt) throw new Error("Missing prompt in response");
        return { reasoning, prompt, rawResponse: raw };
      } catch (e) {
        throw new Error("Failed to parse new-challenger response: " + String(e));
      }
    }
  );
}

/** @kind workflow_chat — 翻译（经 gate → AI Gateway Job） */
export async function translateToChinese(
  text: string,
  model?: string,
  options?: GeminiRequestOptions
): Promise<string> {
  const source = (text || "").trim();
  if (!source) return "";
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    {
      kind: "workflow_chat",
      registryId: resolvedModel,
      role: "text",
      debugFields: () => ({ registryId: resolvedModel, textPath: "ai_gateway" }),
    },
    async () => {
      const out = await arenaTextViaGateway({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Translate the following text into concise Simplified Chinese. Keep structure, bullet points, and code-like fragments when possible. Output ONLY the translated text.",
              },
              { text: source.slice(0, 12000) },
            ],
          },
        ],
        model: resolvedModel,
        uiSource: "unifiedAiGateway.translateToChinese",
        abortSignal: options?.abortSignal,
      });
      if (!out?.trim()) throw new Error("Empty translation response");
      return out.trim();
    }
  );
}

/** @kind workflow_image_edit — 多参考生图（经 gate）；仅 AI Gateway */
export async function dialogGenerateImageMulti(
  ...args: Parameters<typeof dialogGenerateImageMultiRaw>
): ReturnType<typeof dialogGenerateImageMultiRaw> {
  return workflowGenerateImageMultiRefs(...args);
}

/**
 * @kind workflow_chat — 分镜表结构分析（D6：AI Gateway text Job；失败返回 null 与旧行为一致）
 */
export async function analyzeStoryboardSheetStructureInImage(
  base64Image: string,
  model?: string,
  options?: GeminiRequestOptions
): Promise<StoryboardSheetStructureAnalysisRaw | null> {
  const resolvedModel = model != null && String(model).trim() !== "" ? String(model).trim() : DEFAULT_MODEL_TEXT;
  const dataUrl = toVisionDataUrl(base64Image);
  if (!dataUrl) return null;
  try {
    return await runMeteredAiCall(
      {
        kind: "workflow_chat",
        registryId: resolvedModel,
        role: "text",
        debugFields: () => ({ registryId: resolvedModel }),
      },
      async () => {
        const text = await runUnifiedVisionTextGeneration({
          prompt: buildStoryboardSheetStructureAnalysisPrompt(),
          model: resolvedModel,
          images: [dataUrl],
          responseMimeType: "application/json",
          uiSource: "storyboard.sheet_structure",
          metadata: { storyboardSheetStructure: true },
          abortSignal: abortSignalFromGeminiOptions(options),
        });
        const obj = parseJsonObjectFromModelText(text || "");
        const shotCount = Number(obj.shotCount);
        const cols = Number(obj.cols);
        const rows = Number(obj.rows);
        const emptyCellCount = Number(obj.emptyCellCount);
        const shotNos = Array.isArray(obj.shotNos)
          ? obj.shotNos.map((item) => String(item ?? "").trim()).filter(Boolean)
          : [];
        if (!Number.isFinite(shotCount) || !Number.isFinite(cols) || !Number.isFinite(rows)) {
          return null;
        }
        return {
          shotCount: Math.round(shotCount),
          cols: Math.round(cols),
          rows: Math.round(rows),
          shotNos,
          emptyCellCount: Number.isFinite(emptyCellCount) ? Math.max(0, Math.round(emptyCellCount)) : 0,
        };
      }
    );
  } catch {
    return null;
  }
}

export {
  AC_AI_WORKER_FAIRNESS_REJECTED_EVENT,
  AiWorkerProxyFairnessRejectedError,
  isAiWorkerProxyFairnessRejectedError,
  throwFairnessRejected,
  type AcGeminiFairnessRejectedDetail,
} from "./aiWorkerProxyFairnessError";

export {
  AC_UNIFIED_AI_SOFT_NOTICE_EVENT,
  clipUnifiedAiNoticeMessage,
  dispatchUnifiedAiSoftNotice,
  type AcUnifiedAiSoftNoticeDetail,
  type AcUnifiedAiSoftNoticeKind,
} from "./unifiedAiSoftNotice";

// ----- Tripo（生 3D） -----

export type {
  TripoCreateTaskInput,
  TripoTaskResult,
  TripoTaskStatus,
  TripoTaskType,
} from "./tripoService";

export async function createTripoTask(input: TripoCreateTaskInput): Promise<string> {
  return runMeteredAiCall(
    {
      kind: "workflow_generate_3d",
      generate3dProvider: "tripo",
      hasTripoApiKey: Boolean(input.apiKey?.trim()),
      debugFields: () => ({ taskType: input.type }),
    },
    () => createTripoTaskImpl(input)
  );
}

export { getTripoTaskImpl as getTripoTask, waitTripoTaskDoneImpl as waitTripoTaskDone };

// ----- 腾讯混元生 3D（ai3d） -----

export type {
  TencentCredentials,
  TencentRequestOptions,
  TaskResponse,
  File3D,
  Submit3DProInput,
  ProJobResult,
  Submit3DRapidInput,
  SubmitReduceFaceInput,
  SubmitTextureTo3DInput,
  SubmitPartInput,
  SubmitProfileTo3DInput,
} from "./tencentService";

export {
  isUnsafeTencentBrowserModeEnabled,
  PRO_VIEW_IDS,
  PRO_VIEW_LABELS,
  submitHunyuanTo3DProJob,
  queryHunyuanTo3DProJob,
  submitHunyuanTo3DRapidJob,
  queryHunyuanTo3DRapidJob,
  convert3DFormat,
  submitReduceFaceJob,
  describeReduceFaceJob,
  startReduceFaceJob,
  submitTextureTo3DJob,
  describeTextureTo3DJob,
  startTextureTo3DJob,
  submitHunyuanTo3DUVJob,
  describeHunyuanTo3DUVJob,
  startUVJob,
  submitHunyuan3DPartJob,
  queryHunyuan3DPartJob,
  startPartJob,
  submitProfileTo3DJob,
  describeProfileTo3DJob,
  startProfileTo3DJob,
  getTencentCredsFromEnv,
} from "./tencentService";

/** @kind workflow_generate_3d — 腾讯混元 Pro（经 gate，BYOK 旁路） */
export async function startTencent3DProJob(
  ...args: Parameters<typeof startTencent3DProJobRaw>
): ReturnType<typeof startTencent3DProJobRaw> {
  return runMeteredAiCall(
    {
      kind: "workflow_generate_3d",
      generate3dProvider: "tencent",
      debugFields: () => ({ provider: "tencent", module: "pro" }),
    },
    () => startTencent3DProJobRaw(...args)
  );
}

/** @kind workflow_generate_3d — 腾讯混元 Rapid（经 gate，BYOK 旁路） */
export async function startTencent3DRapidJob(
  ...args: Parameters<typeof startTencent3DRapidJobRaw>
): ReturnType<typeof startTencent3DRapidJobRaw> {
  return runMeteredAiCall(
    {
      kind: "workflow_generate_3d",
      generate3dProvider: "tencent",
      debugFields: () => ({ provider: "tencent", module: "rapid" }),
    },
    () => startTencent3DRapidJobRaw(...args)
  );
}

// ----- 生视频（仅 AI Gateway Job） -----

export type { WorkflowVideoJobInput, WorkflowVideoJobResult };
export { WorkflowVideoNotAvailableError };

export function isWorkflowVideoAvailable(): boolean {
  return isAiGatewayVideoExecutionEnabled();
}

/** @kind workflow_generate_video — 仅 AI Gateway Job */
export async function workflowGenerateVideo(input: WorkflowVideoJobInput): Promise<WorkflowVideoJobResult> {
  if (!isAiGatewayVideoExecutionEnabled()) {
    throw new WorkflowVideoNotAvailableError();
  }
  return runMeteredAiCall(
    {
      kind: "workflow_generate_video",
      debugFields: () => ({
        promptLen: String((input.prompt || "").length),
        refImageCount: String(input.referenceImages?.length ?? 0),
        videoPath: "ai_gateway",
      }),
    },
    async ({ billingDecision }) => {
      const estimatedCredits = Number(billingDecision.platformReserve?.estimatedCredits || 50);
      return createAndPollAiGatewayVideoJob({
        ...input,
        registryId: input.registryId || "jimeng-video-ti2v-v30-pro",
        estimatedCredits,
      });
    }
  );
}

// ----- 即梦 Jimeng（volcengine-jimeng，实现见 services/jimeng/*） -----

export type { JimengSubmitInput };
export { JimengNotConfiguredError };

export async function isJimengAvailable(): Promise<boolean> {
  return isJimengAvailableImpl();
}

/** @kind workflow_jimeng_image — 仅 AI Gateway（jimeng-visual） */
export async function workflowGenerateImageJimeng(
  input: JimengSubmitInput
): Promise<{ images: string[] }> {
  if (!(await isJimengAvailable())) {
    throw new JimengNotConfiguredError();
  }
  return runMeteredAiCall(
    {
      kind: "workflow_jimeng_image",
      registryId: input.registryId,
      role: "image",
      debugFields: () => ({
        provider: "volcengine-jimeng",
        registryId: input.registryId,
        promptLen: String((input.prompt || "").length),
        jimengPath: "ai_gateway",
      }),
    },
    async ({ billingDecision }) => {
      const estimatedCredits = Number(billingDecision.platformReserve?.estimatedCredits || 50);
      const result = await createAndPollAiGatewayJimengImageJob({
        ...input,
        estimatedCredits,
      });
      return { images: result.images };
    }
  );
}

/** @kind workflow_jimeng_video — 仅 AI Gateway（jimeng-visual） */
export async function workflowGenerateVideoJimeng(
  input: JimengSubmitInput
): Promise<WorkflowVideoJobResult> {
  if (!(await isJimengAvailable())) {
    throw new JimengNotConfiguredError();
  }
  return runMeteredAiCall(
    {
      kind: "workflow_jimeng_video",
      registryId: input.registryId,
      role: "image",
      debugFields: () => ({
        provider: "volcengine-jimeng",
        registryId: input.registryId,
        promptLen: String((input.prompt || "").length),
        jimengPath: "ai_gateway",
      }),
    },
    async ({ billingDecision }) => {
      const estimatedCredits = Number(billingDecision.platformReserve?.estimatedCredits || 88);
      return createAndPollAiGatewayJimengVideoJob({
        ...input,
        estimatedCredits,
      });
    }
  );
}
