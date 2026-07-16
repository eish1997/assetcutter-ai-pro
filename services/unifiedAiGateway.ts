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
 * - **生视频**：配置 **`VITE_WORKFLOW_VIDEO_API_URL`** 时 `workflowGenerateVideo` POST 桥接后端；未配置则抛 **`WorkflowVideoNotAvailableError`**；**`isWorkflowVideoAvailable()`** 反映是否已配置 URL。
 * - **即梦 Jimeng**：`workflowGenerateImageJimeng` / `workflowGenerateVideoJimeng` / `workflowGenerateDigitalHumanJimeng` 经站内 `/api/jimeng/*`；**`isJimengAvailable()`** 读 status API。
 * - **排障**：构建变量 **`VITE_DEBUG_UNIFIED_AI=1`** 时，`workflow*` 委托在控制台输出 **`[unified-ai]`** 行 + **结构化第二参数**（`provider`、`registryId`/`model`、失败时的 **`errorHint`** 启发式分类），默认关闭。
 * - **Gemini 代理公平限流**：代理返回 **`rate_limited` / `queue_overflow`** 时底层抛 **`AiWorkerProxyFairnessRejectedError`**（本文件再导出）；**`throwFairnessRejected`** 同步派发 **`ac:ai-worker-proxy-fairness-rejected`** 供根组件浮层提示。
 * - **工作流软提示**：凡经 **`runMeteredAiCall`** 的 **`workflow*`** 失败且启发式为限流/繁忙（且**非**公平拒绝类）时，节流派发 **`ac:unified-ai-soft-notice`**（见 **`unifiedAiSoftNotice.ts`**）；对话等经本文件 **`getDialogTextResponse`** 包装同样走 gate。
 *
 * @see docs/多模型可运营改造计划.md §3.6
 */

import {
  CAPABILITY_UNDERSTAND_RETRY_OPTIONS,
  dialogGenerateImage as dialogGenerateImageRaw,
  dialogGenerateImageMulti as dialogGenerateImageMultiRaw,
  getDialogTextResponse as getDialogTextResponseRaw,
  understandImageEditIntent as understandImageEditIntentRaw,
  getSiteAssistantResponse as getSiteAssistantResponseRaw,
  getSiteAssistantResponseStream as getSiteAssistantResponseStreamRaw,
  detectObjectsInImage as detectObjectsInImageRaw,
  describeImageSubject as describeImageSubjectRaw,
  generatePBRTexture as generatePBRTextureRaw,
  generateArenaABPrompts as generateArenaABPromptsRaw,
  generateArenaPrompts as generateArenaPromptsRaw,
  optimizeLoserPrompt as optimizeLoserPromptRaw,
  generateNewChallenger as generateNewChallengerRaw,
  translateToChinese as translateToChineseRaw,
  analyzeStoryboardSheetStructureInImage as analyzeStoryboardSheetStructureInImageRaw,
  type GeminiImageBatchGroupOptions,
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
  isWorkflowVideoBridgeConfigured,
  requestWorkflowVideoFromEnv,
} from "./workflowVideoBridge";
import {
  createAndPollAiGatewayVideoJob,
  isAiGatewayVideoExecutionEnabled,
} from "./aiGatewayVideoExecution";
import { AiWorkerProxyFairnessRejectedError } from "./aiWorkerProxyFairnessError";
import { dispatchUnifiedAiSoftNotice, clipUnifiedAiNoticeMessage } from "./unifiedAiSoftNotice";
import { emitMeteredUsageAfterDelivery } from "./observability/metering/pipeline";
import { meterReadingFromTask } from "./observability/metering/adapters/task";
import { resolveBillingSkuForWorkflowVideo, resolveBillingSkuForJimeng } from "./usageBillingSku";
import { gateBeforeUpstream } from "./aiDispatchGate";
import { markCreditsProxyHeadersFromGate } from "./creditsProxyBridge";
import type { BillingDecision } from "../shared/billingDecision";
import { peekCorrelationContext } from "./observability/correlationContext";
import {
  submitAndPollJimengImage,
  submitAndPollJimengOmniHuman,
  submitAndPollJimengVideo,
} from "./jimeng/adapter";
import { isJimengAvailable as isJimengAvailableImpl } from "./jimeng/client";
import { JimengNotConfiguredError } from "./jimeng/errors";
import type { JimengOmniHumanInput, JimengSubmitInput } from "./jimeng/types";
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
  | "workflow_jimeng_video"
  | "workflow_jimeng_digital_human";

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

/** 仅用于调试日志，非权威分类（与 HTTP 状态码或供应商枚举无严格对应） */
function unifiedAiErrorHint(message: string): "rate_limit" | "upstream_busy" | "auth_config" | "other" {
  const s = message;
  if (/rate_limited|秒后可重试|取号过快|排队深度|user_rpm/i.test(s)) return "rate_limit";
  if (/queue_overflow|队列已满|全站排队|global_queue/i.test(s)) return "upstream_busy";
  if (/429|RESOURCE_EXHAUSTED|rate limit|Too Many Requests/i.test(s)) return "rate_limit";
  if (/503|529|UNAVAILABLE|overloaded|upstream connect error|connection reset|EAI_AGAIN/i.test(s)) return "upstream_busy";
  if (/401|403|API key|apikey|unauthorized|PERMISSION_DENIED|invalid api key/i.test(s)) return "auth_config";
  return "other";
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

function extraMetaFromBillingDecision(billingDecision: BillingDecision): Record<string, unknown> | undefined {
  if (billingDecision.routeKind === "platform") return undefined;
  return { byok: true, billingRouteKind: billingDecision.routeKind };
}

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
        : unifiedAiErrorHint(msg);
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
export type { GeminiImageBatchGroupOptions, GeminiRequestOptions };

/** @kind workflow_chat — 纯文字对话（经 gate） */
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
      debugFields: () => ({ registryId: resolvedModel }),
    },
    () => getDialogTextResponseRaw(contents, model, options)
  );
}

/** @kind workflow_understand — 理解生图意图（经 gate） */
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
      debugFields: () => ({ registryId: resolvedModel }),
    },
    () => understandImageEditIntentRaw(imageBase64, userPrompt, model, customPrompt, options)
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
      debugFields: () => ({ registryId: resolvedModel }),
    },
    () =>
      dialogGenerateImageRaw(
        imageBase64,
        instruction,
        model,
        options,
        customSystemPrompt,
        abortSignal,
        requestOptions
      )
  );
}

/** @kind workflow_chat — 网站助手（经 gate） */
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
      debugFields: () => ({ registryId: resolvedModel }),
    },
    () => getSiteAssistantResponseRaw(userMessage, history, model, options)
  );
}

/** @kind workflow_chat — 网站助手流式（经 gate） */
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
      debugFields: () => ({ registryId: resolvedModel }),
    },
    () => getSiteAssistantResponseStreamRaw(userMessage, history, onChunk, model, options)
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
  return runMeteredAiCall(
    {
      kind: "workflow_image_edit",
      registryId: model != null && model !== "" ? String(model) : undefined,
      role: "image",
      debugFields: () => ({
        registryId: model != null && model !== "" ? String(model) : undefined,
        refImageCount: String(Array.isArray(imagesBase64) ? imagesBase64.length : 0),
      }),
    },
    () => dialogGenerateImageMultiRaw(imagesBase64, instruction, model, options, abortSignal, requestOptions)
  );
}

/** @kind workflow_chat — 单图物体检测（经 gate） */
export async function detectObjectsInImage(
  base64Image: Parameters<typeof detectObjectsInImageRaw>[0],
  model?: Parameters<typeof detectObjectsInImageRaw>[1],
  customPrompt?: Parameters<typeof detectObjectsInImageRaw>[2],
  options?: Parameters<typeof detectObjectsInImageRaw>[3]
): ReturnType<typeof detectObjectsInImageRaw> {
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    { kind: "workflow_chat", registryId: resolvedModel, role: "text", debugFields: () => ({ registryId: resolvedModel }) },
    () => detectObjectsInImageRaw(base64Image, model, customPrompt, options)
  );
}

/** @kind workflow_understand — 描述图片主体（经 gate） */
export async function describeImageSubject(
  base64Image: Parameters<typeof describeImageSubjectRaw>[0],
  model?: Parameters<typeof describeImageSubjectRaw>[1],
  customPrompt?: Parameters<typeof describeImageSubjectRaw>[2],
  options?: Parameters<typeof describeImageSubjectRaw>[3]
): ReturnType<typeof describeImageSubjectRaw> {
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    { kind: "workflow_understand", registryId: resolvedModel, role: "text", debugFields: () => ({ registryId: resolvedModel }) },
    () => describeImageSubjectRaw(base64Image, model, customPrompt, options)
  );
}

/** @kind workflow_image_edit — PBR 贴图生成（经 gate） */
export async function generatePBRTexture(
  functionalMaps: Parameters<typeof generatePBRTextureRaw>[0],
  prompt: Parameters<typeof generatePBRTextureRaw>[1],
  targetType: Parameters<typeof generatePBRTextureRaw>[2],
  baseColorMap?: Parameters<typeof generatePBRTextureRaw>[3],
  options?: Parameters<typeof generatePBRTextureRaw>[4]
): ReturnType<typeof generatePBRTextureRaw> {
  const modelId = "gemini-2.5-flash-image";
  return runMeteredAiCall(
    { kind: "workflow_image_edit", registryId: modelId, role: "image", debugFields: () => ({ registryId: modelId }) },
    () => generatePBRTextureRaw(functionalMaps, prompt, targetType, baseColorMap, options)
  );
}

/** @kind workflow_chat — 擂台 A/B 提示词（经 gate） */
export async function generateArenaABPrompts(
  userDescription: Parameters<typeof generateArenaABPromptsRaw>[0],
  model?: Parameters<typeof generateArenaABPromptsRaw>[1],
  options?: Parameters<typeof generateArenaABPromptsRaw>[2]
): ReturnType<typeof generateArenaABPromptsRaw> {
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    { kind: "workflow_chat", registryId: resolvedModel, role: "text", debugFields: () => ({ registryId: resolvedModel }) },
    () => generateArenaABPromptsRaw(userDescription, model, options)
  );
}

/** @kind workflow_chat — 擂台提示词（经 gate） */
export async function generateArenaPrompts(
  ...args: Parameters<typeof generateArenaPromptsRaw>
): ReturnType<typeof generateArenaPromptsRaw> {
  const model = args[2];
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    { kind: "workflow_chat", registryId: resolvedModel, role: "text", debugFields: () => ({ registryId: resolvedModel }) },
    () => generateArenaPromptsRaw(...args)
  );
}

/** @kind workflow_chat — 擂台优化败者（经 gate） */
export async function optimizeLoserPrompt(
  ...args: Parameters<typeof optimizeLoserPromptRaw>
): ReturnType<typeof optimizeLoserPromptRaw> {
  const model = args[3];
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    { kind: "workflow_chat", registryId: resolvedModel, role: "text", debugFields: () => ({ registryId: resolvedModel }) },
    () => optimizeLoserPromptRaw(...args)
  );
}

/** @kind workflow_chat — 擂台新挑战者（经 gate） */
export async function generateNewChallenger(
  ...args: Parameters<typeof generateNewChallengerRaw>
): ReturnType<typeof generateNewChallengerRaw> {
  const model = args[2];
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    { kind: "workflow_chat", registryId: resolvedModel, role: "text", debugFields: () => ({ registryId: resolvedModel }) },
    () => generateNewChallengerRaw(...args)
  );
}

/** @kind workflow_chat — 翻译（经 gate） */
export async function translateToChinese(
  ...args: Parameters<typeof translateToChineseRaw>
): ReturnType<typeof translateToChineseRaw> {
  const model = args[1];
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    { kind: "workflow_chat", registryId: resolvedModel, role: "text", debugFields: () => ({ registryId: resolvedModel }) },
    () => translateToChineseRaw(...args)
  );
}

/** @kind workflow_image_edit — 多参考生图（经 gate） */
export async function dialogGenerateImageMulti(
  ...args: Parameters<typeof dialogGenerateImageMultiRaw>
): ReturnType<typeof dialogGenerateImageMultiRaw> {
  const model = args[2];
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    { kind: "workflow_image_edit", registryId: resolvedModel, role: "image", debugFields: () => ({ registryId: resolvedModel }) },
    () => dialogGenerateImageMultiRaw(...args)
  );
}

/** @kind workflow_chat — 分镜表结构分析（经 gate） */
export async function analyzeStoryboardSheetStructureInImage(
  ...args: Parameters<typeof analyzeStoryboardSheetStructureInImageRaw>
): ReturnType<typeof analyzeStoryboardSheetStructureInImageRaw> {
  const model = args[1];
  const resolvedModel = model != null && model !== "" ? String(model) : undefined;
  return runMeteredAiCall(
    { kind: "workflow_chat", registryId: resolvedModel, role: "text", debugFields: () => ({ registryId: resolvedModel }) },
    () => analyzeStoryboardSheetStructureInImageRaw(...args)
  );
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

// ----- 生视频（HTTP 桥，实现见 workflowVideoBridge.ts） -----

export type { WorkflowVideoJobInput, WorkflowVideoJobResult };
export { WorkflowVideoNotAvailableError };

export function isWorkflowVideoAvailable(): boolean {
  return isAiGatewayVideoExecutionEnabled() || isWorkflowVideoBridgeConfigured();
}

/** @kind workflow_generate_video — AI Gateway video worker first, legacy endpoint as fallback */
export async function workflowGenerateVideo(input: WorkflowVideoJobInput): Promise<WorkflowVideoJobResult> {
  if (!isAiGatewayVideoExecutionEnabled() && !isWorkflowVideoBridgeConfigured()) {
    throw new WorkflowVideoNotAvailableError();
  }
  return runMeteredAiCall(
    {
      kind: "workflow_generate_video",
      debugFields: () => ({
        promptLen: String((input.prompt || "").length),
        refImageCount: String(input.referenceImages?.length ?? 0),
      }),
    },
    async ({ billingDecision }) => {
      const estimatedCredits = Number(billingDecision.platformReserve?.estimatedCredits || 50);
      let result: WorkflowVideoJobResult;
      let settledByAiGateway = false;
      try {
        if (!isAiGatewayVideoExecutionEnabled()) throw new WorkflowVideoNotAvailableError();
        result = await createAndPollAiGatewayVideoJob({
          ...input,
          registryId: input.registryId || "jimeng-video-ti2v-v30-pro",
          estimatedCredits,
        });
        settledByAiGateway = true;
      } catch (e) {
        if (!isWorkflowVideoBridgeConfigured()) throw e;
        result = await requestWorkflowVideoFromEnv(input);
      }
      const requestId =
        (result as { jobId?: string; taskId?: string }).jobId ||
        (result as { jobId?: string; taskId?: string }).taskId ||
        `video-${Date.now()}`;
      if (!settledByAiGateway) {
        emitMeteredUsageAfterDelivery({
          reading: meterReadingFromTask({ provider: "workflow-video", modality: "video" }),
          registryId: "workflow-video",
          billingSku: resolveBillingSkuForWorkflowVideo(),
          idempotencyPrefix: `workflow-video:${requestId}`,
          requestId: String(requestId),
          jobKind: "workflow_generate_video",
          extraMeta: extraMetaFromBillingDecision(billingDecision),
        });
      }
      return result;
    }
  );
}

// ----- 即梦 Jimeng（volcengine-jimeng，实现见 services/jimeng/*） -----

export type { JimengSubmitInput, JimengOmniHumanInput };
export { JimengNotConfiguredError };

export async function isJimengAvailable(): Promise<boolean> {
  return isJimengAvailableImpl();
}

/** @kind workflow_jimeng_image */
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
      }),
    },
    async ({ billingDecision }) => {
      const result = await submitAndPollJimengImage(input);
      emitMeteredUsageAfterDelivery({
        reading: meterReadingFromTask({ provider: "volcengine-jimeng", modality: "task" }),
        registryId: input.registryId,
        billingSku: resolveBillingSkuForJimeng(input.registryId),
        idempotencyPrefix: `jimeng:${result.taskId}`,
        requestId: result.taskId,
        jobKind: "workflow_jimeng_image",
        extraMeta: extraMetaFromBillingDecision(billingDecision),
      });
      return { images: result.images };
    }
  );
}

/** @kind workflow_jimeng_video */
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
      }),
    },
    async ({ billingDecision }) => {
      const result = await submitAndPollJimengVideo(input);
      emitMeteredUsageAfterDelivery({
        reading: meterReadingFromTask({ provider: "volcengine-jimeng", modality: "video" }),
        registryId: input.registryId,
        billingSku: resolveBillingSkuForJimeng(input.registryId),
        idempotencyPrefix: `jimeng:${result.taskId}`,
        requestId: result.taskId,
        jobKind: "workflow_jimeng_video",
        extraMeta: extraMetaFromBillingDecision(billingDecision),
      });
      return { videoUrl: result.videoUrl };
    }
  );
}

/** @kind workflow_jimeng_digital_human */
export async function workflowGenerateDigitalHumanJimeng(
  input: JimengOmniHumanInput
): Promise<WorkflowVideoJobResult> {
  if (!(await isJimengAvailable())) {
    throw new JimengNotConfiguredError();
  }
  return runMeteredAiCall(
    {
      kind: "workflow_jimeng_digital_human",
      registryId: input.registryId,
      role: "image",
      debugFields: () => ({
        provider: "volcengine-jimeng",
        registryId: input.registryId,
      }),
    },
    async ({ billingDecision }) => {
      const result = await submitAndPollJimengOmniHuman(input);
      emitMeteredUsageAfterDelivery({
        reading: meterReadingFromTask({ provider: "volcengine-jimeng", modality: "task" }),
        registryId: input.registryId,
        billingSku: resolveBillingSkuForJimeng(input.registryId),
        idempotencyPrefix: `jimeng:${result.taskId}`,
        requestId: result.taskId,
        jobKind: "workflow_jimeng_digital_human",
        extraMeta: extraMetaFromBillingDecision(billingDecision),
      });
      return { videoUrl: result.videoUrl };
    }
  );
}
