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
 * - **排障**：构建变量 **`VITE_DEBUG_UNIFIED_AI=1`** 时，`workflow*` 委托在控制台输出 **`[unified-ai]`** 行 + **结构化第二参数**（`provider`、`registryId`/`model`、失败时的 **`errorHint`** 启发式分类），默认关闭。
 * - **Gemini 代理公平限流**：代理返回 **`rate_limited` / `queue_overflow`** 时底层抛 **`GeminiProxyFairnessRejectedError`**（本文件再导出）；**`throwFairnessRejected`** 同步派发 **`ac:gemini-proxy-fairness-rejected`** 供根组件浮层提示。
 * - **工作流软提示**：凡经 **`traceUnifiedAiCall`** 的 **`workflow*`** 失败且启发式为限流/繁忙（且**非**公平拒绝类）时，节流派发 **`ac:unified-ai-soft-notice`**（见 **`unifiedAiSoftNotice.ts`**）；对话等直连 **`getDialogTextResponse`** 仍走各页本地错误 UI。
 *
 * @see docs/多模型可运营改造计划.md §3.6
 */

import {
  CAPABILITY_UNDERSTAND_RETRY_OPTIONS,
  dialogGenerateImage,
  dialogGenerateImageMulti,
  getDialogTextResponse,
  understandImageEditIntent,
  type GeminiImageBatchGroupOptions,
  type GeminiRequestOptions,
} from "./geminiService";
import { getEnabledChannels } from "./settingsStore";
import {
  WorkflowVideoNotAvailableError,
  type WorkflowVideoJobInput,
  type WorkflowVideoJobResult,
  isWorkflowVideoBridgeConfigured,
  requestWorkflowVideoFromEnv,
} from "./workflowVideoBridge";
import { GeminiProxyFairnessRejectedError } from "./geminiProxyFairnessError";
import { dispatchUnifiedAiSoftNotice, clipUnifiedAiNoticeMessage } from "./unifiedAiSoftNotice";
import { emitMeteredUsage } from "./observability/metering/pipeline";
import { meterReadingFromTask } from "./observability/metering/adapters/task";
import { resolveBillingSkuForWorkflowVideo } from "./usageBillingSku";
import { assertUnifiedProxyCreditsGate } from "./proxyCreditsGate";
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
  | "workflow_generate_video";

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

/**
 * 包装全部 **`workflow*`** 调用：始终 try/catch（公平拒绝已在 `geminiService` 派发专用事件，此处不重复）；
 * 限流/繁忙类错误节流派发软提示；**`VITE_DEBUG_UNIFIED_AI=1`** 时额外打 `[unified-ai]` 控制台日志。
 */
async function traceUnifiedAiCall<T>(
  kind: UnifiedAiJobKind,
  fn: () => Promise<T>,
  debugFields?: () => UnifiedAiDebugFields
): Promise<T> {
  const t0 = nowMs();
  const debug = isViteDebugUnifiedAi();
  const channels = getEnabledChannels().join(",");
  const fields = { channels, ...(debugFields?.() ?? {}) };
  try {
    await assertUnifiedProxyCreditsGate(kind);
    const out = await fn();
    if (debug) console.info(`[unified-ai] ${kind} ok ${Math.round(nowMs() - t0)}ms`, fields);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errorHint =
      isCreditsExceededError(e)
        ? "credits_exceeded"
        : e instanceof GeminiProxyFairnessRejectedError
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
    if (!(e instanceof GeminiProxyFairnessRejectedError)) {
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
  }
}

// ----- 自 geminiService 再导出（全站业务只从本文件引用） -----

export {
  DEFAULT_PROMPTS,
  normalizeApiErrorMessage,
  detectObjectsInImage,
  getGeminiImageBatchBoxSizeForCurrentProvider,
  processTexture,
  getTexturePrompt,
  parsePromptStructured,
  generatePBRTexture,
  getSiteAssistantResponseStream,
  getSiteAssistantResponse,
  generateArenaPrompts,
  optimizeLoserPrompt,
  generateNewChallenger,
  translateToChinese,
  generateSessionTitle,
  getEditPrompt,
  dialogGenerateImages,
  understandImageEditIntent,
  getDialogTextResponse,
  dialogGenerateImage,
  dialogGenerateImageMulti,
  generateArenaABPrompts,
  describeImageSubject,
  analyzeStoryboardSheetStructureInImage,
  buildStoryboardSheetStructureAnalysisPrompt,
  withGeminiRequestControl,
} from "./geminiService";

export { CAPABILITY_UNDERSTAND_RETRY_OPTIONS };
export type { GeminiImageBatchGroupOptions, GeminiRequestOptions };

// ----- 命名委托（工作流/能力执行器沿用 workflow* 名） -----

/** @kind workflow_chat */
export async function workflowChat(
  contents: Parameters<typeof getDialogTextResponse>[0],
  model?: Parameters<typeof getDialogTextResponse>[1],
  options?: Parameters<typeof getDialogTextResponse>[2]
): ReturnType<typeof getDialogTextResponse> {
  return traceUnifiedAiCall("workflow_chat", () => getDialogTextResponse(contents, model, options), () => ({
    registryId: model != null && model !== "" ? String(model) : undefined,
  }));
}

/** @kind workflow_understand */
export async function workflowUnderstandForImageGen(
  imageBase64: Parameters<typeof understandImageEditIntent>[0],
  userPrompt: Parameters<typeof understandImageEditIntent>[1],
  model?: Parameters<typeof understandImageEditIntent>[2],
  customPrompt?: Parameters<typeof understandImageEditIntent>[3],
  options?: Parameters<typeof understandImageEditIntent>[4]
): ReturnType<typeof understandImageEditIntent> {
  return traceUnifiedAiCall(
    "workflow_understand",
    () => understandImageEditIntent(imageBase64, userPrompt, model, customPrompt, options),
    () => ({ registryId: model != null && model !== "" ? String(model) : undefined })
  );
}

/** @kind workflow_text_to_image | workflow_image_edit */
export async function workflowGenerateImage(
  imageBase64: Parameters<typeof dialogGenerateImage>[0],
  instruction: Parameters<typeof dialogGenerateImage>[1],
  model?: Parameters<typeof dialogGenerateImage>[2],
  options?: Parameters<typeof dialogGenerateImage>[3],
  customSystemPrompt?: Parameters<typeof dialogGenerateImage>[4],
  abortSignal?: Parameters<typeof dialogGenerateImage>[5],
  requestOptions?: Parameters<typeof dialogGenerateImage>[6]
): ReturnType<typeof dialogGenerateImage> {
  return traceUnifiedAiCall(
    "workflow_text_to_image",
    () =>
      dialogGenerateImage(
        imageBase64,
        instruction,
        model,
        options,
        customSystemPrompt,
        abortSignal,
        requestOptions
      ),
    () => ({ registryId: model != null && model !== "" ? String(model) : undefined })
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
  return traceUnifiedAiCall(
    "workflow_image_edit",
    () => dialogGenerateImageMulti(imagesBase64, instruction, model, options, abortSignal, requestOptions),
    () => ({
      registryId: model != null && model !== "" ? String(model) : undefined,
      refImageCount: String(Array.isArray(imagesBase64) ? imagesBase64.length : 0),
    })
  );
}

export {
  AC_GEMINI_FAIRNESS_REJECTED_EVENT,
  GeminiProxyFairnessRejectedError,
  isGeminiProxyFairnessRejectedError,
  throwFairnessRejected,
  type AcGeminiFairnessRejectedDetail,
} from "./geminiProxyFairnessError";

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
  return traceUnifiedAiCall(
    "workflow_generate_3d",
    () => createTripoTaskImpl(input),
    () => ({ taskType: input.type })
  );
}

export { getTripoTaskImpl as getTripoTask, waitTripoTaskDoneImpl as waitTripoTaskDone };

// ----- 腾讯混元生 3D（ai3d，实现见 tencentService.ts） -----
export * from "./tencentService";

// ----- 生视频（HTTP 桥，实现见 workflowVideoBridge.ts） -----

export type { WorkflowVideoJobInput, WorkflowVideoJobResult };
export { WorkflowVideoNotAvailableError };

export function isWorkflowVideoAvailable(): boolean {
  return isWorkflowVideoBridgeConfigured();
}

/** @kind workflow_generate_video — POST 至 `VITE_WORKFLOW_VIDEO_API_URL` */
export async function workflowGenerateVideo(input: WorkflowVideoJobInput): Promise<WorkflowVideoJobResult> {
  if (!isWorkflowVideoBridgeConfigured()) {
    throw new WorkflowVideoNotAvailableError();
  }
  return traceUnifiedAiCall(
    "workflow_generate_video",
    async () => {
      const result = await requestWorkflowVideoFromEnv(input);
      const requestId =
        (result as { jobId?: string; taskId?: string }).jobId ||
        (result as { jobId?: string; taskId?: string }).taskId ||
        `video-${Date.now()}`;
      emitMeteredUsage({
        reading: meterReadingFromTask({ provider: 'workflow-video', modality: 'video' }),
        registryId: 'workflow-video',
        billingSku: resolveBillingSkuForWorkflowVideo(),
        idempotencyPrefix: `workflow-video:${requestId}`,
        requestId: String(requestId),
        jobKind: 'workflow_generate_video',
      });
      return result;
    },
    () => ({
      promptLen: String((input.prompt || "").length),
      refImageCount: String(input.referenceImages?.length ?? 0),
    })
  );
}
