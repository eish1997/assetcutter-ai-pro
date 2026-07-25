/**
 * 大模型**实现层**（`getAI()`、各 RPC）。UI / hooks / 组件请 **`import unifiedAiGateway`**，
 * 勿直接依赖本文件，便于供应商与观测统一演进。
 */
import { GoogleGenAI, Type } from "@google/genai";
import { createOpenAiGeminiClient } from "./openaiAdapter";
import { createToapisGeminiClient } from "./toapisAdapter";
import { createVectorengineGeminiClient } from "./vectorengineAdapter";
import {
  getOpenaiApiKey,
  getOpenaiBaseUrl,
  getTinysnowApiKey,
  getTinysnowBaseUrl,
  getToapisApiKey,
  getToapisBaseUrl,
  getUserApiKey,
  getVolcengineArkApiKey,
  getVolcengineArkBaseUrl,
  getVectorengineApiKey,
  getVectorengineBaseUrl,
} from "./settingsStore";
import { emitMeteredUsageAfterDelivery, emitMeteredUsageAwait } from "./observability/metering/pipeline";
import { meterReadingFromAiWorkerProxy } from "./observability/metering/adapters/gemini";
import {
  wrapGeminiClientWithChannelMetering,
  stripMeteringConfigKeys,
  resolveMeteringRegistryId,
  type GeminiClientLike as MeteredGeminiClientLike,
} from "./observability/metering/emitGeminiChannel";
import {
  isLikelyImageRegistryId,
  resolveProviderForGeminiPath,
} from "./observability/metering/resolveBillingSku";
import type { UsageGeminiMetadata } from "../shared/usageBilling";
import { proxyGateMinCreditsForJob } from "../shared/credits";
import { apiUrl, authApiRelayConfigured, devUsesRemoteAuthViaViteProxy, resolvedAuthApiBaseUrl } from "./apiBase";
import {
  getCachedCreditsProxyHeaders,
  getCreditsProxyRequestHeaders,
  getLastCreditsReserveKey,
  clearLastCreditsReserveKey,
  releaseCreditsProxyReserve,
} from "./creditsProxyBridge";
import { getGeminiFairnessRequestHeaders } from "./geminiFairnessBridge";
import { peekCreditsPrechargeSession } from "./creditsPrechargeSession";
import { AiPipelineStepError, detectPipelineStepFromMessage, isAiPipelineStepError, logAiPipelineDev } from "./aiPipelineStepError";
import {
  dataUrlPayloadBytes,
  MAX_WORKFLOW_VISION_IMAGE_BYTES,
  normalizeDataUrlForVisionApi,
} from "./workflowImageDataUrlCompress";
import {
  getEnvelopeProxyAdmissionHeaders,
  getActiveAiTaskEnvelopeRequestHeaders,
  isAiTaskEnvelopeActive,
} from "./aiTaskEnvelope";
import {
  GeminiAsyncPollTimeoutError,
  dispatchGeminiAsyncRecovered,
  expireStaleGeminiAsyncJobs,
  geminiAsyncJobNotFoundUserMessage,
  getPendingGeminiAsyncJob,
  isGeminiAsyncJobNotFoundPoll,
  isGeminiAsyncPollTimeoutError,
  listPendingGeminiAsyncJobs,
  markGeminiAsyncJobRecoverable,
  removePendingGeminiAsyncJob,
  shouldGraceRetryGeminiAsyncJobNotFound,
  touchGeminiAsyncJobPoll,
  upsertPendingGeminiAsyncJob,
} from "./geminiAsyncJobRecovery";
import { peekCorrelationContext } from "./observability/correlationContext";
import { releaseCreditReserve } from "./creditsApi";
import { tryParseAiWorkerProxyFairnessRejected, throwFairnessRejected } from "./aiWorkerProxyFairnessError";
import {
  dispatchGeminiFairnessRetryWait,
  dispatchGeminiQueueHint,
  dispatchGeminiQueueProgress,
  type GeminiQueueMeta,
} from "./geminiQueueProgress";
import { DEFAULT_MODEL_IMAGE, DEFAULT_MODEL_TEXT } from "./modelRegistry/constants";
import type { ChannelId } from "./modelRegistry/types";
import { pickBinding } from "./modelRegistry/pickBinding";
import {
  aiWorkerProxyUsesVertexBackend,
  pickChannel,
  usesVertexProxyForImage,
  usesVertexProxyForText,
} from "./modelRegistry/bindingRuntime";
import {
  buildAiGatewayImageJobTraceBody,
  extractAiGatewayTraceJobId,
  isAiGatewayImageExecutionEnabled,
  isAiGatewayJobTraceEnabled,
} from "./aiGatewayTrace";
import { createAiGatewayImageExecutionJob } from "./aiGatewayImageExecution";
import { rememberAiGatewayImageResult } from "./aiGatewayImageResultRegistry";
import {
  resolveUpstreamImageModelId,
  resolveUpstreamImageModelIdForRegistry,
  resolveUpstreamModelId,
  resolveUpstreamModelIdForProvider,
  resolveUpstreamTextModelId,
} from "./modelRegistry/resolve";
import { coerceImageModelRegistryId, imageModelProviderRoute } from "./modelRegistry/imageModels";
import {
  aiWorkerProxyForwardOriginIndex,
  collectRemoteAiWorkerProxyOriginsFromEnv,
  DEFAULT_AI_WORKER_PROXY_ORIGIN,
} from "./aiWorkerProxyForwardDevOrigins";

export {
  resolveUpstreamImageModelId,
  resolveUpstreamImageModelIdForRegistry,
  resolveUpstreamModelId,
  resolveUpstreamModelIdForProvider,
  resolveUpstreamTextModelId,
};
export type { ModelResolveRole } from "./modelRegistry/resolve";

function readViteEnvTrim(key: string): string {
  try {
    return String(
      ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key] || "").trim()
    );
  } catch {
    return "";
  }
}

const AI_WORKER_PROXY_RAW =
  typeof import.meta !== "undefined" && (import.meta as unknown as { env?: Record<string, string | undefined> })?.env
    ? readViteEnvTrim("VITE_AI_WORKER_PROXY_API")
    : "";

/** 仅当供应商选「Vertex AI」时使用：可与 `VITE_AI_WORKER_PROXY_API` 不同，指向已配 Vertex+ADC 的 ai-worker-proxy。 */
const VERTEX_AI_WORKER_PROXY_RAW =
  typeof import.meta !== "undefined" && (import.meta as unknown as { env?: Record<string, string | undefined> })?.env
    ? readViteEnvTrim("VITE_AI_WORKER_PROXY_API_VERTEX")
    : "";

/** 与当前页面同源（配合 Vite `/proxy/gemini` → 本机 9002），避免跨端口 CORS */
const AI_WORKER_PROXY_SAME_ORIGIN_MARKER = "__SAME_ORIGIN__";

/** 开发环境：经 Vite 同源转发到公网 AI Worker Proxy，避免浏览器直连 Render 触发 CORS（与 `vite.config.ts` 白名单一致） */
const AC_AI_WORKER_FORWARD_PREFIX = "/__ac-ai-worker-forward";

function aiWorkerProxyDevForwardOrigins(): string[] {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
    return collectRemoteAiWorkerProxyOriginsFromEnv(env);
  } catch {
    return [];
  }
}

function resolveAiWorkerProxyBaseFromRaw(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (t === "1" || lower === "true" || lower === "same-origin") {
    return AI_WORKER_PROXY_SAME_ORIGIN_MARKER;
  }
  return t;
}

const AI_WORKER_PROXY_BASE = resolveAiWorkerProxyBaseFromRaw(AI_WORKER_PROXY_RAW);
const VERTEX_AI_WORKER_PROXY_BASE = resolveAiWorkerProxyBaseFromRaw(VERTEX_AI_WORKER_PROXY_RAW);

/** 选 Vertex 时若 `VITE_AI_WORKER_PROXY_API` 仍指向未配 Vertex 的旧主机会 500；可设 `VITE_VERTEX_FALLBACK_AI_WORKER_PROXY_API` 或使用下方默认已配 Vertex 的代理根。 */
const VERTEX_FALLBACK_AI_WORKER_PROXY_RAW =
  typeof import.meta !== "undefined" && (import.meta as unknown as { env?: Record<string, string | undefined> })?.env
    ? readViteEnvTrim("VITE_VERTEX_FALLBACK_AI_WORKER_PROXY_API")
    : "";
const DEFAULT_VERTEX_OK_AI_WORKER_PROXY = DEFAULT_AI_WORKER_PROXY_ORIGIN;
const VERTEX_MISCONFIGURED_PROXY_HOSTS = new Set(
  ["assetcutter-ai-pro.onrender.com", "assetcutter-ai-pro.org", "www.assetcutter-ai-pro.org"].map((h) => h.toLowerCase())
);

function vertexFallbackAiWorkerProxyBase(): string {
  const v = VERTEX_FALLBACK_AI_WORKER_PROXY_RAW.replace(/\/$/, "");
  return v || DEFAULT_VERTEX_OK_AI_WORKER_PROXY;
}

function usesVertexAiWorkerEndpoint(): boolean {
  return usesVertexProxyForImage() || usesVertexProxyForText();
}

function redirectVertexAwayFromUnconfiguredProxy(base: string): string {
  if (!usesVertexAiWorkerEndpoint()) return base;
  if (readViteEnvTrim("VITE_DISABLE_VERTEX_AI_WORKER_PROXY_FALLBACK") === "true") return base;
  if (!base || base === AI_WORKER_PROXY_SAME_ORIGIN_MARKER) return base;
  let host = "";
  try {
    const normalized = /^https?:\/\//i.test(base) ? base : `https://${base}`;
    host = new URL(normalized).hostname.toLowerCase();
  } catch {
    return base;
  }
  if (!VERTEX_MISCONFIGURED_PROXY_HOSTS.has(host)) return base;
  return vertexFallbackAiWorkerProxyBase();
}

/** Vertex 且配置了 `VITE_AI_WORKER_PROXY_API_VERTEX` 时走专用代理根；否则与试用相同用 `VITE_AI_WORKER_PROXY_API`。 */
function effectiveAiWorkerProxyBase(): string {
  let base: string;
  if (usesVertexAiWorkerEndpoint() && VERTEX_AI_WORKER_PROXY_BASE) base = VERTEX_AI_WORKER_PROXY_BASE;
  else base = AI_WORKER_PROXY_BASE;
  return redirectVertexAwayFromUnconfiguredProxy(base);
}

/** 为 true 时恢复旧行为：本机 Gemini Key 优先于 VITE_AI_WORKER_PROXY_API（浏览器直连 Google）。默认 false：有代理地址则优先走后端代理，与生产环境一致、避免本机 Key 直连触发地区限制。 */
function preferBrowserGeminiKeyFirst(): boolean {
  try {
    return (
      String(
        (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_USE_BROWSER_GEMINI_KEY_FIRST || ""
      ).trim() === "true"
    );
  } catch {
    return false;
  }
}

function isLocalDevPage(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function shouldRelayAiWorkerProxyViaAuthApi(baseResolved: string): boolean {
  if (typeof window === "undefined") return false;
  if (!baseResolved || baseResolved === AI_WORKER_PROXY_SAME_ORIGIN_MARKER) return false;
  if (!authApiRelayConfigured()) return false;
  try {
    const aiWorkerProxyOrigin = new URL(
      /^https?:\/\//i.test(baseResolved) ? baseResolved : `https://${baseResolved}`
    ).origin;
    if (aiWorkerProxyOrigin === window.location.origin) return false;
    if (resolvedAuthApiBaseUrl()) {
      const authOrigin = new URL(
        /^https?:\/\//i.test(resolvedAuthApiBaseUrl()) ? resolvedAuthApiBaseUrl() : `https://${resolvedAuthApiBaseUrl()}`
      ).origin;
      if (authOrigin === window.location.origin) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** 7525000 起 AI Worker Proxy 默认 credentials:include；直连跨域 ai-worker-proxy 会触发 credentialed CORS 预检失败 → fetch failed */
export function resolveAiWorkerProxyFetchCredentials(
  input: RequestInfo | URL,
  init?: RequestInit
): RequestCredentials {
  if (init?.credentials) return init.credentials;
  const urlStr =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : String(input);
  if (typeof window === "undefined") return "same-origin";
  try {
    if (urlStr.startsWith("/") && !urlStr.startsWith("//")) return "include";
    if (urlStr.startsWith(window.location.origin)) return "include";
  } catch {
    /* ignore */
  }
  const authBase = resolvedAuthApiBaseUrl();
  if (authBase) {
    try {
      const authOrigin = new URL(
        /^https?:\/\//i.test(authBase) ? authBase : `https://${authBase}`
      ).origin;
      if (urlStr.startsWith(authOrigin)) return "include";
    } catch {
      /* ignore */
    }
  }
  return "omit";
}

function aiWorkerProxyApiUrl(path: string): string {
  const baseResolved = effectiveAiWorkerProxyBase();
  if (!baseResolved) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  if (baseResolved === AI_WORKER_PROXY_SAME_ORIGIN_MARKER) {
    return p;
  }
  /** 与线上一致：已配置跨域 auth-api 时走 /api/ai-worker-proxy 中继（Cookie + 积分头一并转发） */
  if (shouldRelayAiWorkerProxyViaAuthApi(baseResolved)) {
    return apiUrl(`/api/ai-worker-proxy${p}`);
  }
  /** 本地 npm run dev：无 auth 中继时经 Vite /__ac-ai-worker-forward 转发（须与云端 auth 登录对齐，见 assertDevAiWorkerProxyCreditsAuthAligned） */
  if (import.meta.env.DEV && isLocalDevPage()) {
    const idx = aiWorkerProxyForwardOriginIndex(baseResolved, aiWorkerProxyDevForwardOrigins());
    if (idx >= 0) {
      return `${AC_AI_WORKER_FORWARD_PREFIX}/${idx}${p}`;
    }
  }
  const base = baseResolved.replace(/\/$/, "");
  return `${base}${p}`;
}

function aiWorkerProxyUsesDevForward(requestUrl: string): boolean {
  try {
    const u = typeof requestUrl === "string" ? requestUrl : String(requestUrl);
    return u.includes(`${AC_AI_WORKER_FORWARD_PREFIX}/`);
  } catch {
    return false;
  }
}

/** 本地登录 + dev AI Worker Proxy-forward 到 Render 时，云端 proxy 无法识别本机 session */
function assertDevAiWorkerProxyCreditsAuthAligned(requestUrl: string): void {
  if (!import.meta.env.DEV || !aiWorkerProxyUsesDevForward(requestUrl)) return;
  if (resolvedAuthApiBaseUrl() || devUsesRemoteAuthViaViteProxy()) return;
  throw new Error(
    "本地登录与 Render 生图代理不匹配：云端会提示「请先登录」。请在 .env.local 设置 VITE_AUTH_API_BASE_URL=https://assetcutter-auth-api.onrender.com，重启 npm run dev 后重新登录。"
  );
}

/** Render 等对长连接常限 10～15s：走后端异步 job + 轮询，避免 503/504 */
const GEMINI_ASYNC_POLL_MS = 1500;
/** 轮询排队进度写入用户日志的最小间隔 */
const GEMINI_QUEUE_PROGRESS_DISPATCH_MS = 8000;
/** POST 创建遭公平拒绝时的自动重试次数 */
const FAIRNESS_CREATE_MAX_RETRIES = 5;
/** 与 proxy 侧 GEMINI_ASYNC_JOB_MAX_WAIT_MS（默认 300s）对齐，避免前端提前超时 */
const GEMINI_ASYNC_CLIENT_MAX_POLL_MS = 300_000;
/** 生图并发上限（工作流 chunk 并发；默认试用=3、Vertex=4，可用环境变量调整） */
const GEMINI_IMAGE_BATCH_BOX_SIZE_DEFAULT = 3;
const GEMINI_IMAGE_BATCH_BOX_SIZE_VERTEX_DEFAULT = 4;

function readEnvNumber(key: string): number | null {
  try {
    const raw =
      ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key] || '').trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n;
  } catch {
    return null;
  }
}

export function resolveImageBatchBoxSize(aiBackend?: "vertex"): number {
  const envGeneric = readEnvNumber("VITE_GEMINI_IMAGE_BATCH_BOX_SIZE");
  const envVertex = readEnvNumber("VITE_GEMINI_IMAGE_BATCH_BOX_SIZE_VERTEX");
  const defaultSize =
    aiBackend === "vertex" ? GEMINI_IMAGE_BATCH_BOX_SIZE_VERTEX_DEFAULT : GEMINI_IMAGE_BATCH_BOX_SIZE_DEFAULT;
  const raw = aiBackend === "vertex" ? (envVertex ?? envGeneric ?? defaultSize) : (envGeneric ?? defaultSize);
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

export function getGeminiImageBatchBoxSizeForCurrentProvider(registryId?: string): number {
  return resolveImageBatchBoxSize(usesVertexProxyForImage(registryId) ? "vertex" : undefined);
}

/** ai-worker-proxy 在 Vertex 未就绪时返回；映射为工作区可读的完整短句（避免单行截断） */
function userMessageForVertexProxyNotReady(text: string): string | null {
  const t = (text || "").trim();
  if (!t) return null;
  if (
    /Vertex\/Agent Platform 未完成配置/i.test(t) ||
    /Vertex\s*生图尚未就绪/i.test(t) ||
    (/VERTEX_PROJECT_ID|GOOGLE_CLOUD_PROJECT/.test(t) && /未完成配置|尚未就绪|应用默认凭据|ADC/i.test(t))
  ) {
    return "当前使用「Vertex」线路，但生图后台尚未完成 Google Cloud 配置。请在生图代理服务上设置云项目与身份凭据后再试，或在「设置」中暂时改用其它线路。";
  }
  return null;
}

function parseAiWorkerProxyCreateError(status: number, text: string, requestUrl?: string): string {
  const raw = (text || "").trim();
  try {
    const j = JSON.parse(raw) as { error?: string; message?: string; retryAfterSec?: number };
    const code = typeof j.error === "string" ? j.error.trim() : "";
    const msg = (typeof j.message === "string" && j.message.trim()) || code || raw;
    const vertexUser = userMessageForVertexProxyNotReady(msg) || userMessageForVertexProxyNotReady(code);
    if (status === 500 && vertexUser) return vertexUser;
    const ra = j.retryAfterSec;
    if (status === 429 || code === "rate_limited") {
      return ra != null && Number.isFinite(Number(ra))
        ? `${msg}（约 ${Math.ceil(Number(ra))} 秒后可重试）`
        : msg;
    }
    if (status === 503 || code === "queue_overflow") {
      return msg || "队列已满，请稍后重试";
    }
    if (code) return msg;
  } catch {
    /* ignore */
  }
  const base = parseAiWorkerProxyErrorBody(raw) || `Gemini 异步任务创建失败（${status}）`;
  if (status === 405) {
    const urlHint = requestUrl ? ` 请求 URL：${requestUrl}。` : "";
    const prodSameOrigin =
      typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD &&
      effectiveAiWorkerProxyBase() === AI_WORKER_PROXY_SAME_ORIGIN_MARKER;
    const fixHint = prodSameOrigin
      ? "构建时误用了 VITE_AI_WORKER_PROXY_API=same-origin（仅适用于本机 Vite 反代）；请改为与线上一致的 ai-worker-proxy 根地址并重新部署。"
      : "请确认 VITE_AI_WORKER_PROXY_API 指向已部署的 ai-worker-proxy（如 https://assetcutter-ai-worker-proxy.onrender.com），勿指向前端静态站域名。";
    return `${base}${urlHint} ${fixHint}`;
  }
  return base;
}

function parseAiWorkerProxyErrorBody(text: string): string {
  const raw = (text || "").trim();
  try {
    const j = JSON.parse(raw) as { error?: string };
    if (typeof j.error === "string" && j.error.trim()) {
      const e = j.error.trim();
      return userMessageForVertexProxyNotReady(e) || e;
    }
  } catch {
    /* ignore */
  }
  return userMessageForVertexProxyNotReady(raw) || raw;
}

function isBrowserFetchNetworkError(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("fetch failed") ||
    m.includes("networkerror") ||
    m.includes("load failed")
  );
}

function aiWorkerProxyFetchNetworkUserMessage(): string {
  const originHint =
    typeof window !== "undefined" && window.location?.origin
      ? `（当前站点 ${window.location.origin}；若直连 ai-worker-proxy，须加入 PROXY_ALLOWED_ORIGINS）`
      : "";
  if (usesVertexProxyForImage()) {
    return `Vertex 生图服务暂时连不上，请检查网络或稍后再试。若使用公网代理，请确认本机可访问该地址。${originHint}`;
  }
  return `无法连接生图服务，请检查网络后重试。${originHint}`;
}

/** 不把端口/env 细节写进工作区日志；仅开发环境打到控制台 */
function warnDevAiWorkerProxyNetwork(context: string): void {
  try {
    if (!import.meta.env.DEV) return;
    const vx = usesVertexProxyForImage();
    console.warn(
      `[assetcutter] ${context}：请求未送达。${vx ? "Vertex：请确认 VITE_AI_WORKER_PROXY_API（或 VERTEX 专用地址）在浏览器侧可访问，且代理已配置 Vertex；" : ""}若使用同源 /proxy/gemini，请确认本机 ai-worker-proxy 在 9002 且 Vite 已反代。`
    );
  } catch {
    /* ignore */
  }
}

async function aiWorkerProxyFetchOrExplain(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      credentials: resolveAiWorkerProxyFetchCredentials(input, init),
    });
  } catch (e) {
    if (isBrowserFetchNetworkError(e)) {
      warnDevAiWorkerProxyNetwork("生图代理");
      throw new Error(aiWorkerProxyFetchNetworkUserMessage());
    }
    throw e;
  }
}

async function aiWorkerProxyFetchCreateWithFairnessRetry(
  url: string,
  init: RequestInit
): Promise<{ ok: true; text: string } | { ok: false; status: number; text: string }> {
  const abortSignal = init.signal ?? undefined;
  for (let attempt = 1; attempt <= FAIRNESS_CREATE_MAX_RETRIES; attempt += 1) {
    const response = await aiWorkerProxyFetchOrExplain(url, init);
    const text = await response.text();
    if (response.ok) return { ok: true, text };
    const fairnessErr = tryParseAiWorkerProxyFairnessRejected(response.status, text);
    if (!fairnessErr || attempt >= FAIRNESS_CREATE_MAX_RETRIES) {
      return { ok: false, status: response.status, text };
    }
    const waitSec = fairnessErr.retryAfterSec ?? Math.min(30, 5 + attempt * 2);
    dispatchGeminiFairnessRetryWait({
      retryAfterSec: waitSec,
      attempt,
      maxAttempts: FAIRNESS_CREATE_MAX_RETRIES,
    });
    const jitterMs = Math.floor(Math.random() * 400);
    await sleepWithAbort(waitSec * 1000 + jitterMs, abortSignal);
  }
  return { ok: false, status: 429, text: '{"error":"rate_limited","message":"公平队列重试耗尽"}' };
}

let aiWorkerProxySessionHintDone = false;
let aiWorkerProxyFairnessProbe: Promise<{ enabled: boolean; globalQueuedApprox?: number } | null> | null = null;

async function probeAiWorkerProxyFairnessOnce(): Promise<{ enabled: boolean; globalQueuedApprox?: number } | null> {
  if (!effectiveAiWorkerProxyBase()) return null;
  try {
    const res = await aiWorkerProxyFetchOrExplain(aiWorkerProxyApiUrl("/healthz"), { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      fairness?: { enabled?: boolean; globalQueuedApprox?: number };
    };
    const f = j.fairness;
    if (!f || typeof f !== "object") return { enabled: false };
    return {
      enabled: f.enabled === true,
      globalQueuedApprox:
        f.globalQueuedApprox != null && Number.isFinite(Number(f.globalQueuedApprox))
          ? Math.floor(Number(f.globalQueuedApprox))
          : undefined,
    };
  } catch {
    return null;
  }
}

async function ensureAiWorkerProxySessionHint(): Promise<void> {
  if (typeof window === "undefined" || aiWorkerProxySessionHintDone) return;
  aiWorkerProxySessionHintDone = true;
  aiWorkerProxyFairnessProbe ??= probeAiWorkerProxyFairnessOnce();
  const info = await aiWorkerProxyFairnessProbe;
  dispatchGeminiQueueHint({
    kind: "proxy_session",
    fairnessEnabled: info?.enabled === true,
    globalQueuedApprox: info?.globalQueuedApprox,
  });
}

function parseAsyncCreateBody(text: string): { jobId: string; createStatus: string } {
  try {
    const parsed = JSON.parse(text) as { jobId?: string; status?: string };
    return {
      jobId: String(parsed.jobId || ""),
      createStatus: String(parsed.status || "pending").trim() || "pending",
    };
  } catch {
    return { jobId: "", createStatus: "pending" };
  }
}

type GeminiAsyncPollBody = {
  status?: string;
  result?: { text?: string; candidates?: unknown[]; items?: unknown[] };
  error?: string;
  queueMeta?: GeminiQueueMeta;
};

function emitThrottledQueueProgress(args: {
  jobId: string;
  status: "queued" | "running";
  queueMeta: GeminiQueueMeta;
  queueWaitStartedAt: number;
  lastProgressAtRef: { t: number };
  runningLoggedRef: { v: boolean };
}): void {
  const now = Date.now();
  if (args.status === "running") {
    if (args.runningLoggedRef.v) return;
    args.runningLoggedRef.v = true;
    dispatchGeminiQueueProgress({
      jobId: args.jobId,
      status: "running",
      queueMeta: args.queueMeta,
      waitedMs: now - args.queueWaitStartedAt,
    });
    return;
  }
  if (now - args.lastProgressAtRef.t < GEMINI_QUEUE_PROGRESS_DISPATCH_MS) return;
  args.lastProgressAtRef.t = now;
  dispatchGeminiQueueProgress({
    jobId: args.jobId,
    status: "queued",
    queueMeta: args.queueMeta,
    waitedMs: now - args.queueWaitStartedAt,
  });
}

type GeminiAsyncPollTracker = {
  queueWaitStartedAt: number;
  lastProgressAtRef: { t: number };
  runningLoggedRef: { v: boolean };
  sawQueuedRef: { v: boolean };
  directHintRef: { v: boolean };
  waitingHintRef: { v: boolean };
};

function createGeminiAsyncPollTracker(): GeminiAsyncPollTracker {
  return {
    queueWaitStartedAt: Date.now(),
    lastProgressAtRef: { t: 0 },
    runningLoggedRef: { v: false },
    sawQueuedRef: { v: false },
    directHintRef: { v: false },
    waitingHintRef: { v: false },
  };
}

function handleGeminiAsyncPollWaitState(
  jobId: string,
  j: GeminiAsyncPollBody,
  tracker: GeminiAsyncPollTracker
): void {
  if (j.status === "queued") {
    tracker.sawQueuedRef.v = true;
    if (j.queueMeta) {
      emitThrottledQueueProgress({
        jobId,
        status: "queued",
        queueMeta: j.queueMeta,
        queueWaitStartedAt: tracker.queueWaitStartedAt,
        lastProgressAtRef: tracker.lastProgressAtRef,
        runningLoggedRef: tracker.runningLoggedRef,
      });
      return;
    }
    const now = Date.now();
    if (!tracker.waitingHintRef.v && now - tracker.lastProgressAtRef.t >= GEMINI_QUEUE_PROGRESS_DISPATCH_MS) {
      tracker.waitingHintRef.v = true;
      tracker.lastProgressAtRef.t = now;
      dispatchGeminiQueueHint({ kind: "job_waiting", jobId });
    }
    return;
  }
  if (j.status === "running") {
    if (j.queueMeta) {
      emitThrottledQueueProgress({
        jobId,
        status: "running",
        queueMeta: j.queueMeta,
        queueWaitStartedAt: tracker.queueWaitStartedAt,
        lastProgressAtRef: tracker.lastProgressAtRef,
        runningLoggedRef: tracker.runningLoggedRef,
      });
    } else if (!tracker.directHintRef.v && !tracker.sawQueuedRef.v) {
      tracker.directHintRef.v = true;
      dispatchGeminiQueueHint({ kind: "job_direct", jobId });
    }
  }
}

function emitGeminiAsyncDoneNoQueueHint(jobId: string, tracker: GeminiAsyncPollTracker): void {
  if (tracker.sawQueuedRef.v || tracker.runningLoggedRef.v || tracker.directHintRef.v) return;
  dispatchGeminiQueueHint({
    kind: "job_done_no_queue",
    jobId,
    waitedMs: Date.now() - tracker.queueWaitStartedAt,
  });
}

type GeminiAsyncDelivered = {
  text?: string;
  candidates?: unknown[];
  usageMetadata?: UsageGeminiMetadata | null;
};

type GeminiAsyncPollStep =
  | { kind: "completed"; result: GeminiAsyncDelivered }
  | { kind: "failed"; error: string }
  | { kind: "pending" };

function isTransientAsyncPollError(error: unknown): boolean {
  const msg = String((error as Error)?.message ?? error ?? "");
  return /terminated|connection terminated|UND_ERR_SOCKET|other side closed|fetch failed|failed to fetch|ECONNRESET|ETIMEDOUT/i.test(msg);
}

async function fetchGeminiAsyncPollStep(
  jobId: string,
  tracker: GeminiAsyncPollTracker,
  abortSignal?: AbortSignal
): Promise<GeminiAsyncPollStep> {
  let pollRes: Response;
  try {
    pollRes = await aiWorkerProxyFetchOrExplain(aiWorkerProxyApiUrl(`/proxy/gemini/async/${encodeURIComponent(jobId)}`), {
      signal: abortSignal,
      cache: "no-store",
    });
  } catch (error) {
    if (!abortSignal?.aborted && isTransientAsyncPollError(error)) {
      logAiPipelineDev("error", {
        step: "image_poll",
        code: "ASYNC_POLL_TRANSIENT_NETWORK",
        jobId,
        raw: String((error as Error)?.message || error),
      });
      return { kind: "pending" };
    }
    throw error;
  }
  const pollText = await pollRes.text();
  if (!pollRes.ok) {
    const pt = (pollText || "").trim();
    const fe = tryParseAiWorkerProxyFairnessRejected(pollRes.status, pt);
    if (fe) throwFairnessRejected(fe);
    if (isGeminiAsyncJobNotFoundPoll(pollRes.status, pt)) {
      const createdAt = getPendingGeminiAsyncJob(jobId)?.createdAt;
      if (shouldGraceRetryGeminiAsyncJobNotFound(createdAt)) {
        logAiPipelineDev("error", {
          step: "image_poll",
          code: "ASYNC_JOB_NOT_FOUND_GRACE",
          jobId,
          raw: pt,
        });
        return { kind: "pending" };
      }
      throw new AiPipelineStepError(
        "image_poll",
        "ASYNC_JOB_NOT_FOUND",
        geminiAsyncJobNotFoundUserMessage()
      );
    }
    throw new AiPipelineStepError(
      "image_poll",
      "ASYNC_POLL_HTTP",
      parseAiWorkerProxyErrorBody(pt) || `轮询失败（${pollRes.status}）`
    );
  }
  let j: GeminiAsyncPollBody;
  try {
    j = JSON.parse(pollText) as GeminiAsyncPollBody;
  } catch {
    throw new Error("轮询响应无效");
  }
  if (j.status === "completed" && j.result != null) {
    emitGeminiAsyncDoneNoQueueHint(jobId, tracker);
    return { kind: "completed", result: j.result as GeminiAsyncDelivered };
  }
  if (j.status === "failed") {
    const rawErr = j.error || "Gemini 任务失败";
    return { kind: "failed", error: rawErr };
  }
  handleGeminiAsyncPollWaitState(jobId, j, tracker);
  return { kind: "pending" };
}

async function finalizeGeminiAsyncDelivery(args: {
  jobId: string;
  model: string;
  bindingRegistryId: string;
  delivered: GeminiAsyncDelivered;
  creditsReserveKey?: string | null;
  aiGatewayJobId?: string | null;
}): Promise<GeminiAsyncDelivered> {
  const imageRole = isLikelyImageRegistryId(args.bindingRegistryId);
  const useVertex = aiWorkerProxyUsesVertexBackend(args.bindingRegistryId, imageRole ? "image" : "text");
  const meterArgs = {
    jobId: args.jobId,
    model: args.model,
    registryId: args.bindingRegistryId,
    useVertex,
    proxyResult: args.delivered,
    usageMetadata: args.delivered.usageMetadata,
    jobKind: imageRole ? "workflow_image" : "workflow_chat",
    creditsReserveKey: args.creditsReserveKey ?? getLastCreditsReserveKey(),
  };
  if (peekCreditsPrechargeSession()) {
    await emitAiWorkerProxyMeteredUsage(meterArgs);
  } else {
    settleAiWorkerProxyMeteredUsageAfterDelivery(meterArgs);
  }
  const imageResult = extractAiWorkerProxyImageDataUrl(args.delivered);
  if (imageResult) {
    rememberAiGatewayImageResult(imageResult, args.aiGatewayJobId);
  }
  return args.delivered;
}

function registerGeminiAsyncJobForRecovery(args: {
  jobId: string;
  model: string;
  registryId: string;
  useVertex: boolean;
}): void {
  const ctx = peekCorrelationContext();
  upsertPendingGeminiAsyncJob({
    jobId: args.jobId,
    kind: "async",
    model: args.model,
    registryId: args.registryId,
    prechargeKey: getLastCreditsReserveKey(),
    workflowTaskId: ctx.correlationId ?? null,
    assetId: ctx.assetId ?? null,
    projectId: ctx.projectId ?? null,
    actionType: ctx.actionType ?? null,
    useVertex: args.useVertex,
  });
}

/** 从 proxy async 结果提取首张图 data URL（工作流恢复用） */
export function extractAiWorkerProxyImageDataUrl(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { candidates?: unknown[] };
  const candidates = Array.isArray(r.candidates) ? r.candidates : [];
  for (const c of candidates) {
    const parts = (c as { content?: { parts?: unknown[] } })?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const inline = (part as { inlineData?: { mimeType?: string; data?: string } })?.inlineData;
      if (inline?.data) {
        const mime = String(inline.mimeType || "image/png");
        return `data:${mime};base64,${inline.data}`;
      }
    }
  }
  return null;
}

export { GeminiAsyncPollTimeoutError, isGeminiAsyncPollTimeoutError };

/** 续 poll 可恢复的 Gemini 异步任务 */
export async function resumeGeminiAsyncJob(
  jobId: string
): Promise<GeminiAsyncDelivered> {
  const job = getPendingGeminiAsyncJob(jobId);
  if (!job) {
    throw new Error("恢复任务不存在或已过期");
  }
  if (job.prechargeKey) {
    setLastCreditsReserveKey(job.prechargeKey);
  }
  const deadline = Date.now() + GEMINI_ASYNC_CLIENT_MAX_POLL_MS;
  const tracker = createGeminiAsyncPollTracker();
  while (Date.now() < deadline) {
    touchGeminiAsyncJobPoll(jobId);
    const step = await fetchGeminiAsyncPollStep(jobId, tracker);
    if (step.kind === "completed") {
      removePendingGeminiAsyncJob(jobId);
      const delivered = await finalizeGeminiAsyncDelivery({
        jobId,
        model: job.model,
        bindingRegistryId: job.registryId,
        delivered: step.result,
        creditsReserveKey: job.prechargeKey,
      });
      dispatchGeminiAsyncRecovered({
        jobId,
        workflowTaskId: job.workflowTaskId,
        assetId: job.assetId,
        projectId: job.projectId,
        actionType: job.actionType,
        result: delivered,
      });
      return delivered;
    }
    if (step.kind === "failed") {
      removePendingGeminiAsyncJob(jobId);
      if (!peekCreditsPrechargeSession() && job.prechargeKey) {
        await releaseCreditReserve(job.prechargeKey);
      }
      throw new Error(step.error);
    }
    await sleepWithAbort(GEMINI_ASYNC_POLL_MS);
  }
  markGeminiAsyncJobRecoverable(jobId);
  throw new GeminiAsyncPollTimeoutError(jobId, GEMINI_ASYNC_CLIENT_MAX_POLL_MS);
}

/** 页面 focus / 启动时尝试恢复所有未完成异步任务 */
export async function retryAllRecoverableGeminiJobs(): Promise<void> {
  await expireStaleGeminiAsyncJobs();
  const jobs = listPendingGeminiAsyncJobs();
  for (const job of jobs) {
    try {
      await resumeGeminiAsyncJob(job.jobId);
    } catch (e) {
      if (!isGeminiAsyncPollTimeoutError(e)) {
        try {
          if (import.meta.env.DEV) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn("[gemini-async-recovery] 恢复失败:", job.jobId, msg);
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function isCreditsReserveInvalidProxyError(status: number, text: string): boolean {
  if (status !== 403) return false;
  const raw = (text || "").trim();
  if (/CREDITS_RESERVE_INVALID/i.test(raw)) return true;
  return /积分预扣无效|积分预扣.*过期/i.test(raw);
}

function throwCreditsReserveInvalid(step: 'credits_gate' | 'credits_bundle', raw: string): never {
  const detail = (raw || '').trim();
  throw new AiPipelineStepError(
    step,
    'CREDITS_RESERVE_INVALID',
    detail && /积分预扣/.test(detail)
      ? detail
      : '积分预扣无效或已过期，请刷新页面后单次重试（勿连点队列）'
  );
}

async function aiWorkerProxyAdmissionHeaders(estimatedCredits: number): Promise<Record<string, string>> {
  const fallback = {
    ...getGeminiFairnessRequestHeaders(),
    ...getActiveAiTaskEnvelopeRequestHeaders(),
  };
  const fromEnvelope = getEnvelopeProxyAdmissionHeaders(estimatedCredits);
  if (fromEnvelope) {
    return { ...fallback, ...fromEnvelope };
  }
  const cached = getCachedCreditsProxyHeaders(estimatedCredits);
  if (cached) {
    return { ...fallback, ...cached };
  }
  const proxyHeaders = await getCreditsProxyRequestHeaders(estimatedCredits);
  return { ...fallback, ...proxyHeaders };
}

async function emitAiWorkerProxyMeteredUsage(args: {
  jobId: string;
  model: string;
  registryId?: string;
  useVertex?: boolean;
  usageMetadata?: UsageGeminiMetadata | null;
  proxyResult?: unknown;
  jobKind?: string;
  creditsReserveKey?: string | null;
}): Promise<void> {
  const registryId = (args.registryId || args.model || "").trim();
  if (!registryId) return;
  const reserveKey = (args.creditsReserveKey ?? getLastCreditsReserveKey())?.trim() || null;
  await emitMeteredUsageAwait({
    reading: meterReadingFromAiWorkerProxy({
      registryId,
      provider: resolveProviderForGeminiPath(args.useVertex),
      usageMetadata: args.usageMetadata,
      proxyResult: args.proxyResult,
    }),
    registryId,
    idempotencyPrefix: `gemini-async:${args.jobId}`,
    requestId: args.jobId,
    jobKind: args.jobKind,
    extraMeta: reserveKey ? { creditsReserveKey: reserveKey } : undefined,
  });
}

/** 先返回结果，后台结算（P2） */
function settleAiWorkerProxyMeteredUsageAfterDelivery(args: Parameters<typeof emitAiWorkerProxyMeteredUsage>[0]): void {
  emitMeteredUsageAfterDelivery({
    reading: meterReadingFromAiWorkerProxy({
      registryId: (args.registryId || args.model || "").trim(),
      provider: resolveProviderForGeminiPath(args.useVertex),
      usageMetadata: args.usageMetadata,
      proxyResult: args.proxyResult,
    }),
    registryId: (args.registryId || args.model || "").trim(),
    idempotencyPrefix: `gemini-async:${args.jobId}`,
    requestId: args.jobId,
    jobKind: args.jobKind,
    extraMeta: (() => {
      const key = (args.creditsReserveKey ?? getLastCreditsReserveKey())?.trim();
      return key ? { creditsReserveKey: key } : undefined;
    })(),
  });
}

async function aiWorkerProxyGenerateContentSync(args: {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  registryId?: string;
  jobKind?: string;
  role?: "text" | "image";
}): Promise<{ text?: string; candidates?: unknown[]; usageMetadata?: UsageGeminiMetadata | null }> {
  const config = (args.config || {}) as Record<string, unknown>;
  const abortSignal = config.abortSignal as AbortSignal | undefined;
  const safeConfig = { ...(stripMeteringConfigKeys(config) || {}) };
  delete (safeConfig as { abortSignal?: AbortSignal }).abortSignal;

  const role = args.role ?? "text";
  const jobKind = args.jobKind ?? (role === "text" ? "workflow_understand" : "workflow_text_to_image");
  const bindingRegistryId =
    resolveMeteringRegistryId({ model: args.model, config }) || (args.registryId || args.model || "").trim();
  const aiBackendExtra = aiWorkerProxyUsesVertexBackend(bindingRegistryId, role) ? { aiBackend: "vertex" as const } : {};
  const gateCredits = proxyGateMinCreditsForJob(jobKind);
  let skipReleaseOnFinally = false;
  let frozenCreditsReserveKey: string | null = null;
  try {
    const syncUrl = aiWorkerProxyApiUrl("/proxy/gemini/generate-content");
    assertDevAiWorkerProxyCreditsAuthAligned(syncUrl);
    const createBody = JSON.stringify({
      model: args.model,
      contents: args.contents,
      config: safeConfig,
      estimatedCredits: gateCredits,
      ...aiBackendExtra,
    });
    const postSync = async () => {
      const admissionHeaders = await aiWorkerProxyAdmissionHeaders(gateCredits);
      frozenCreditsReserveKey =
        admissionHeaders['X-AC-Credits-Reserve']?.trim() || getLastCreditsReserveKey();
      return aiWorkerProxyFetchOrExplain(syncUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...admissionHeaders },
        body: createBody,
        signal: abortSignal,
        cache: "no-store",
      });
    };
    let res = await postSync();
    let text = await res.text();
    if (!res.ok && isCreditsReserveInvalidProxyError(res.status, text || "")) {
      // 上一任务结算后偶发复用失效预扣：清缓存后强制新 bundle 再试一次
      clearLastCreditsReserveKey();
      frozenCreditsReserveKey = null;
      res = await postSync();
      text = await res.text();
      if (!res.ok && isCreditsReserveInvalidProxyError(res.status, text || "")) {
        clearLastCreditsReserveKey();
        logAiPipelineDev('error', {
          step: 'credits_gate',
          code: 'CREDITS_RESERVE_INVALID',
          raw: text,
          reserveKey: getLastCreditsReserveKey(),
        });
        throwCreditsReserveInvalid('credits_gate', text || '');
      }
    }
    if (!res.ok) {
      const rawFail = (text || "").trim();
      logAiPipelineDev('error', {
        step: 'understand',
        raw: rawFail,
        reserveKey: frozenCreditsReserveKey ?? getLastCreditsReserveKey(),
      });
      const raw = (text || "").trim();
      const fairnessErr = tryParseAiWorkerProxyFairnessRejected(res.status, raw);
      if (fairnessErr) throwFairnessRejected(fairnessErr);
      throw new Error(parseAiWorkerProxyCreateError(res.status, raw, syncUrl));
    }
    let delivered: { text?: string; candidates?: unknown[]; usageMetadata?: UsageGeminiMetadata | null };
    try {
      delivered = JSON.parse(text) as typeof delivered;
    } catch {
      throw new Error("同步代理响应无效");
    }
    const meterArgs = {
      jobId: `sync:${Date.now()}`,
      model: args.model,
      registryId: bindingRegistryId,
      useVertex: aiWorkerProxyUsesVertexBackend(bindingRegistryId, role),
      proxyResult: delivered,
      usageMetadata: delivered.usageMetadata,
      jobKind,
      creditsReserveKey: frozenCreditsReserveKey ?? getLastCreditsReserveKey(),
    };
    if (peekCreditsPrechargeSession()) {
      await emitAiWorkerProxyMeteredUsage(meterArgs);
    } else {
      settleAiWorkerProxyMeteredUsageAfterDelivery(meterArgs);
    }
    skipReleaseOnFinally = true;
    return delivered;
  } finally {
    if (!skipReleaseOnFinally && !peekCreditsPrechargeSession() && !isAiTaskEnvelopeActive()) {
      await releaseCreditsProxyReserve();
    }
  }
}

async function createAiGatewayImageJobTrace(args: {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  registryId?: string;
  estimatedCredits: number;
  useVertex: boolean;
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  if (!isAiGatewayJobTraceEnabled(args.useVertex)) return null;
  try {
    const url = aiWorkerProxyApiUrl('/ai-gateway/jobs');
    assertDevAiWorkerProxyCreditsAuthAligned(url);
    const response = await aiWorkerProxyFetchOrExplain(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        buildAiGatewayImageJobTraceBody({
          model: args.model,
          contents: args.contents,
          config: args.config,
          registryId: args.registryId,
          estimatedCredits: args.estimatedCredits,
          useVertex: args.useVertex,
        })
      ),
      signal: args.abortSignal,
      cache: 'no-store',
    });
    const text = await response.text();
    if (!response.ok) {
      logAiPipelineDev('warn', {
        step: 'image_create',
        code: 'AI_GATEWAY_TRACE_FAILED',
        status: response.status,
        raw: text,
      });
      return null;
    }
    try {
      return extractAiGatewayTraceJobId(JSON.parse(text));
    } catch {
      return null;
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    logAiPipelineDev('warn', {
      step: 'image_create',
      code: 'AI_GATEWAY_TRACE_ERROR',
      raw: String((error as Error)?.message || error),
    });
    return null;
  }
}

async function aiWorkerProxyGenerateContentAsync(args: {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  registryId?: string;
}): Promise<{ text?: string; candidates?: unknown[]; usageMetadata?: UsageGeminiMetadata | null }> {
  const config = (args.config || {}) as Record<string, unknown>;
  const abortSignal = config.abortSignal as AbortSignal | undefined;
  const safeConfig = { ...(stripMeteringConfigKeys(config) || {}) };
  delete (safeConfig as { abortSignal?: AbortSignal }).abortSignal;
  const httpTimeout =
    Number((safeConfig.httpOptions as Record<string, unknown> | undefined)?.timeout) ||
    GEMINI_IMAGE_REQUEST_TIMEOUT_MS;
  /** 服务端可对 503 多次退避，轮询上限需覆盖 */
  const maxPollMs = Math.max(httpTimeout + 240_000, GEMINI_ASYNC_CLIENT_MAX_POLL_MS);

  await ensureAiWorkerProxySessionHint();

  const bindingRegistryId = resolveMeteringRegistryId({ model: args.model, config }) || (args.registryId || args.model || "").trim();
  const useVertexBackend = aiWorkerProxyUsesVertexBackend(bindingRegistryId, "image");
  const aiBackendExtra = useVertexBackend
    ? { aiBackend: "vertex" as const }
    : {};

  const gateCredits = proxyGateMinCreditsForJob("workflow_text_to_image");
  let skipReleaseOnFinally = false;
  try {
  const asyncCreateUrl = aiWorkerProxyApiUrl("/proxy/gemini/async");
  assertDevAiWorkerProxyCreditsAuthAligned(asyncCreateUrl);
  const gatewayEnabled = isAiGatewayImageExecutionEnabled(useVertexBackend);
  const gatewayExecution = gatewayEnabled
    ? await createAiGatewayImageExecutionJob({
        model: args.model,
        contents: args.contents,
        config: safeConfig,
        registryId: bindingRegistryId,
        estimatedCredits: gateCredits,
        useVertex: useVertexBackend,
        abortSignal,
      })
    : null;
  let aiGatewayTraceJobId: string | null = gatewayExecution?.aiGatewayJobId || null;
  if (gatewayEnabled && !gatewayExecution) {
    throw new Error("AI Gateway image execution unavailable");
  }
  if (gatewayExecution && !gatewayExecution.proxyJobId) {
    throw new Error(
      `AI Gateway image job missing proxy handoff (job=${gatewayExecution.aiGatewayJobId || ""}; status=${gatewayExecution.createStatus})`
    );
  }
  let jobId = gatewayExecution?.proxyJobId || "";
  let createStatus = gatewayExecution?.proxyJobId
    ? `ai-gateway:${gatewayExecution.createStatus}`
    : "";
  if (!jobId) {
  if (gatewayEnabled) {
    throw new Error("AI Gateway image job missing proxyJobId; refusing legacy /proxy/gemini/async fallback");
  }
  const createBody = JSON.stringify({
    model: args.model,
    contents: args.contents,
    config: safeConfig,
    estimatedCredits: gateCredits,
    ...(aiGatewayTraceJobId ? { fairnessMeta: { aiGatewayTraceJobId } } : {}),
    ...aiBackendExtra,
  });
  const postAsyncCreate = async () =>
    aiWorkerProxyFetchCreateWithFairnessRetry(asyncCreateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await aiWorkerProxyAdmissionHeaders(gateCredits)) },
      body: createBody,
      signal: abortSignal,
      cache: "no-store",
    });
  let create = await postAsyncCreate();
  if (!create.ok && isCreditsReserveInvalidProxyError(create.status, create.text || "")) {
    clearLastCreditsReserveKey();
    create = await postAsyncCreate();
    if (!create.ok && isCreditsReserveInvalidProxyError(create.status, create.text || "")) {
      clearLastCreditsReserveKey();
      logAiPipelineDev('error', {
        step: 'credits_gate',
        code: 'CREDITS_RESERVE_INVALID',
        raw: create.text,
        reserveKey: getLastCreditsReserveKey(),
      });
      throwCreditsReserveInvalid('credits_gate', create.text || '');
    }
  }
  if (!create.ok) {
    const raw = (create.text || "").trim();
    logAiPipelineDev('error', {
      step: 'image_create',
      raw,
      reserveKey: getLastCreditsReserveKey(),
    });
    const parsedMsg = parseAiWorkerProxyErrorBody(raw);
    if (/Use POST \/jobs/i.test(raw)) {
      const aiWorkerProxyHint =
        usesVertexProxyForImage(bindingRegistryId) && VERTEX_AI_WORKER_PROXY_BASE
          ? `VITE_AI_WORKER_PROXY_API_VERTEX=${VERTEX_AI_WORKER_PROXY_BASE || "(empty)"}`
          : `VITE_AI_WORKER_PROXY_API=${AI_WORKER_PROXY_BASE || "(empty)"}`;
      throw new Error(
        [
          parsedMsg,
          `当前后端代理地址不是 Gemini 代理：${aiWorkerProxyHint}`,
          "请改为部署了 server/ai-worker-proxy-api.js 的根地址（应支持 POST /proxy/gemini/async）。",
        ].join(" ")
      );
    }
    const fairnessErr = tryParseAiWorkerProxyFairnessRejected(create.status, raw);
    if (fairnessErr) throwFairnessRejected(fairnessErr);
    throw new Error(
      parseAiWorkerProxyCreateError(create.status, raw, aiWorkerProxyApiUrl("/proxy/gemini/async"))
    );
  }
  try {
    const parsed = parseAsyncCreateBody(create.text);
    jobId = parsed.jobId;
    createStatus = parsed.createStatus;
  } catch {
    throw new Error("异步任务响应无效");
  }
  if (!jobId) throw new Error("未返回 jobId");
  }
  if (!jobId) throw new Error("Missing async jobId");
  dispatchGeminiQueueHint({ kind: "job_submitted", jobId, createStatus });
  const asyncReserveKey = getLastCreditsReserveKey();
  registerGeminiAsyncJobForRecovery({
    jobId,
    model: args.model,
    registryId: bindingRegistryId,
    useVertex: aiWorkerProxyUsesVertexBackend(bindingRegistryId, "image"),
  });

  const deadline = Date.now() + maxPollMs;
  const tracker = createGeminiAsyncPollTracker();
  while (Date.now() < deadline) {
    if (abortSignal?.aborted) throw createAbortError("请求已取消");
    touchGeminiAsyncJobPoll(jobId);
    const step = await fetchGeminiAsyncPollStep(jobId, tracker, abortSignal);
    if (step.kind === "completed") {
      removePendingGeminiAsyncJob(jobId);
      return finalizeGeminiAsyncDelivery({
        jobId,
        model: args.model,
        bindingRegistryId,
        delivered: step.result,
        creditsReserveKey: asyncReserveKey,
        aiGatewayJobId: aiGatewayTraceJobId,
      });
    }
    if (step.kind === "failed") {
      removePendingGeminiAsyncJob(jobId);
      logAiPipelineDev('error', {
        step: 'image_poll',
        raw: step.error,
        jobId,
        reserveKey: asyncReserveKey,
      });
      throw new AiPipelineStepError(
        'image_poll',
        'ASYNC_JOB_FAILED',
        step.error || '生图异步任务失败'
      );
    }
    await sleepWithAbort(GEMINI_ASYNC_POLL_MS, abortSignal);
  }
  markGeminiAsyncJobRecoverable(jobId);
  skipReleaseOnFinally = true;
  throw new GeminiAsyncPollTimeoutError(jobId, maxPollMs);
  } finally {
    if (!skipReleaseOnFinally && !peekCreditsPrechargeSession() && !isAiTaskEnvelopeActive()) {
      await releaseCreditsProxyReserve();
    }
  }
}

type GeminiClientLike = {
  models: {
    generateContent: (args: { model: string; contents: unknown; config?: Record<string, unknown> }) => Promise<any>;
    generateContentStream?: (args: {
      model: string;
      contents: unknown;
      config?: Record<string, unknown>;
    }) => AsyncIterable<any>;
  };
};

function withStrippedClientConfig(client: GeminiClientLike): GeminiClientLike {
  return {
    models: {
      async generateContent(args) {
        return client.models.generateContent({
          ...args,
          config: stripMeteringConfigKeys(args.config),
        });
      },
      ...(client.models.generateContentStream
        ? {
            async *generateContentStream(args) {
              const stream = client.models.generateContentStream!({
                ...args,
                config: stripMeteringConfigKeys(args.config),
              });
              yield* stream;
            },
          }
        : {}),
    },
  };
}

function createAiWorkerProxyGeminiTextClient(): GeminiClientLike {
  return {
    models: {
      async generateContent(args) {
        return aiWorkerProxyGenerateContentSync({
          model: args.model,
          contents: args.contents,
          config: stripMeteringConfigKeys((args.config || {}) as Record<string, unknown>) || {},
          role: "text",
          jobKind: "workflow_understand",
        });
      },
    },
  };
}

function createAiWorkerProxyGeminiImageClient(): GeminiClientLike {
  return {
    models: {
      async generateContent(args) {
        return aiWorkerProxyGenerateContentAsync({
          model: args.model,
          contents: args.contents,
          config: stripMeteringConfigKeys((args.config || {}) as Record<string, unknown>) || {},
        });
      },
    },
  };
}

function geminiImageAiWorkerProxyConfigured(): boolean {
  return Boolean(AI_WORKER_PROXY_BASE || effectiveAiWorkerProxyBase());
}

function getClientForChannel(channel: ChannelId, role: "text" | "image" = "text"): GeminiClientLike {
  switch (channel) {
    case "vertex-proxy":
      if (!geminiImageAiWorkerProxyConfigured()) {
        throw new Error("Vertex 代理未配置：需站点 VITE_AI_WORKER_PROXY_API_VERTEX 或 VITE_AI_WORKER_PROXY_API。");
      }
      return role === "image" ? createAiWorkerProxyGeminiImageClient() : createAiWorkerProxyGeminiTextClient();
    case "gemini-aistudio": {
      const apiKey = getUserApiKey();
      if (!apiKey?.trim()) {
        throw new Error("使用 Gemini AI Studio 需先在设置中填写 Gemini API Key。");
      }
      return withStrippedClientConfig(new GoogleGenAI({ apiKey }) as unknown as GeminiClientLike);
    }
    case "toapis-gemini": {
      const k = getToapisApiKey();
      if (!k?.trim()) {
        throw new Error("ToAPIs Gemini 路径需先在设置中填写 ToAPIs API Key。");
      }
      return wrapGeminiClientWithChannelMetering(
        createToapisGeminiClient(getToapisBaseUrl(), k) as unknown as MeteredGeminiClientLike,
        "toapis"
      );
    }
    case "toapis-openai": {
      const k = getToapisApiKey();
      if (!k?.trim()) {
        throw new Error("ToAPIs OpenAI 路径需先在设置中填写 ToAPIs API Key。");
      }
      return createOpenAiGeminiClient(getToapisBaseUrl(), k, { meteringProvider: "toapis" }) as unknown as GeminiClientLike;
    }
    case "vectorengine": {
      const k = getVectorengineApiKey();
      if (!k?.trim()) {
        throw new Error("VectorEngine 通道需先在设置中填写 API Key。");
      }
      return wrapGeminiClientWithChannelMetering(
        createVectorengineGeminiClient(getVectorengineBaseUrl(), k) as unknown as MeteredGeminiClientLike,
        "vectorengine"
      );
    }
    case "openai-official": {
      const k = getOpenaiApiKey();
      if (!k?.trim()) {
        throw new Error("OpenAI 官方通道需先在设置中填写 OpenAI API Key。");
      }
      return createOpenAiGeminiClient(getOpenaiBaseUrl(), k) as unknown as GeminiClientLike;
    }
    case "tinysnow-openai": {
      const k = getTinysnowApiKey();
      if (!k?.trim()) {
        throw new Error("TinySnow channel requires a TinySnow API Key in settings.");
      }
      return createOpenAiGeminiClient(getTinysnowBaseUrl(), k, {
        meteringProvider: "tinysnow",
        imageResponseFormat: "b64_json",
      }) as unknown as GeminiClientLike;
    }
    case "volcengine-ark": {
      const k = getVolcengineArkApiKey();
      if (!k?.trim()) {
        throw new Error("火山方舟通道需要先在设置中填写 API Key。");
      }
      return createOpenAiGeminiClient(getVolcengineArkBaseUrl(), k, {
        meteringProvider: "volcengine-ark",
        baseUrlMode: "raw",
      }) as unknown as GeminiClientLike;
    }
  }
}

/** 生图按 registryId 的 binding 选 channel */
function getAIForImageModel(registryId: string): GeminiClientLike {
  const id = coerceImageModelRegistryId(registryId);
  const picked = pickBinding(id, "image");
  if (picked) return getClientForChannel(picked.channel, "image");
  const route = imageModelProviderRoute(id);
  if (route === "openai") {
    const k = getOpenaiApiKey();
    if (!k) {
      throw new Error("使用 OpenAI 生图模型需先在设置中填写 OpenAI API Key。");
    }
    return createOpenAiGeminiClient(getOpenaiBaseUrl(), k) as unknown as GeminiClientLike;
  }
  const apiKey = getUserApiKey();
  if (apiKey) {
    return withStrippedClientConfig(new GoogleGenAI({ apiKey }) as unknown as GeminiClientLike);
  }
  if (geminiImageAiWorkerProxyConfigured()) {
    return createAiWorkerProxyGeminiImageClient();
  }
  throw new Error(
    "使用 Gemini 生图模型需先在设置中填写 Gemini API Key，或配置 Vertex 代理（VITE_AI_WORKER_PROXY_API）。"
  );
}

/** 文本/理解：按 registryId + binding 取客户端 */
export function getClientForTask(registryId: string, role: "text" | "image" = "text"): GeminiClientLike {
  const id = (registryId || "").trim() || DEFAULT_MODEL_TEXT;
  const picked = pickBinding(id, role);
  if (picked) return getClientForChannel(picked.channel, role);
  if (role === "image") return getAIForImageModel(id);
  if (geminiImageAiWorkerProxyConfigured()) {
    return createAiWorkerProxyGeminiTextClient();
  }
  throw new Error(
    "无可用文本通道：请在设置 → API 供应商中启用 Vertex / ToAPIs 等通道并填写密钥。"
  );
}

function formatRequestTimeoutMessage(timeoutMs: number, phase?: string): string {
  const label = phase?.trim();
  const base = label ? `${label}请求超时（>${timeoutMs}ms）` : `请求超时（>${timeoutMs}ms）`;
  if (label === "生图") {
    return `${base}（客户端停止等待，不代表上游已拒绝；GPT Image high 质量可能需数分钟，勿立即重试以免重复计费）`;
  }
  return base;
}

function usesOpenAiRouteForImage(registryId: string): boolean {
  const id = coerceImageModelRegistryId(registryId);
  const picked = pickBinding(id, "image");
  if (
    picked?.channel === "openai-official" ||
    picked?.channel === "tinysnow-openai" ||
    picked?.channel === "toapis-openai" ||
    picked?.channel === "volcengine-ark"
  ) return true;
  return imageModelProviderRoute(id) === "openai";
}

function shouldUseAiWorkerProxyImageQueueForModel(registryId: string): boolean {
  const picked = pickBinding(coerceImageModelRegistryId(registryId), "image");
  if (picked?.channel === "vertex-proxy" && !getUserApiKey()?.trim()) {
    return geminiImageAiWorkerProxyConfigured();
  }
  if (picked?.channel === "gemini-aistudio" && !getUserApiKey()?.trim()) {
    return false;
  }
  if (!picked) {
    if (getUserApiKey()?.trim()) return false;
    return geminiImageAiWorkerProxyConfigured();
  }
  return false;
}

function isLongImageSizeTier(imageSize?: string): boolean {
  const s = (imageSize || "").trim().toUpperCase();
  return s === "4K" || s === "4";
}

function imageGenTimeoutMsForModel(registryId: string, baseTimeout: number, imageSize?: string): number {
  if (isLongImageSizeTier(imageSize)) {
    return Math.max(baseTimeout, GEMINI_VERTEX_IMAGE_TIMEOUT_MS);
  }
  if (shouldUseAiWorkerProxyImageQueueForModel(registryId)) {
    return Math.max(baseTimeout, GEMINI_VERTEX_IMAGE_TIMEOUT_MS);
  }
  const route = imageModelProviderRoute(coerceImageModelRegistryId(registryId));
  if (route === "gemini" && !getUserApiKey()?.trim() && geminiImageAiWorkerProxyConfigured()) {
    return Math.max(baseTimeout, GEMINI_VERTEX_IMAGE_TIMEOUT_MS);
  }
  if (usesOpenAiRouteForImage(registryId)) {
    return Math.max(baseTimeout, OPENAI_IMAGE_REQUEST_TIMEOUT_MS);
  }
  return baseTimeout;
}

/**
 * 全站统一入口：对话、工作流/能力执行、贴图、擂台、站点助手等通过 binding 取客户端。
 */
const getAI = (): GeminiClientLike => getClientForTask(DEFAULT_MODEL_TEXT, "text");

export interface GeminiRequestOptions {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  /** 提示词擂台：首轮写稿（2～4 人共用一条系统说明；具体 N 在用户消息里） */
  arenaPromptWriter?: string;
  /** @deprecated 使用 `arenaPromptWriter`；仍可读作回退 */
  arenaPromptAb?: string;
  /** @deprecated 使用 `arenaPromptWriter`；仍可读作回退 */
  arenaPromptAbN?: string;
  arenaPromptOptimizeLoser?: string;
  arenaPromptNewChallenger?: string;
  /** 超时日志用：如「生图」「理解」 */
  requestPhase?: string;
  /** 结构化 JSON 输出（如分镜解析/优化） */
  responseMimeType?: string;
}

const GEMINI_REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 45_000;
const GEMINI_IMAGE_REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_IMAGE_REQUEST_TIMEOUT_MS) || 120_000;
/** OpenAI GPT Image（尤其 gpt-image-2 + high quality）常超过 5min；默认 10min，与 Vertex 生图对齐 */
const OPENAI_IMAGE_REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_IMAGE_REQUEST_TIMEOUT_MS) || 600_000;
/** Vertex/trial 生图单项（尤其 4K）常超过 5min；默认 10min，可用 GEMINI_VERTEX_IMAGE_TIMEOUT_MS 覆盖 */
const GEMINI_VERTEX_IMAGE_TIMEOUT_MS = Number(process.env.GEMINI_VERTEX_IMAGE_TIMEOUT_MS) || 600_000;

type GeminiDiagCode =
  | "INPUT_IMAGE_EMPTY"
  | "NO_INLINE_IMAGE_FOUND"
  | "GEMINI_TIMEOUT"
  | "GEMINI_NETWORK"
  | "GEMINI_OVERLOADED"
  | "GEMINI_INTERNAL"
  | "GEMINI_UNKNOWN";

function buildDiagMessage(code: GeminiDiagCode, message: string, detail?: string): string {
  const d = detail ? `｜详情：${detail}` : "";
  return `【${code}】${message}${d}`;
}

function extractDiagCode(raw: string): GeminiDiagCode | null {
  const m = String(raw || "").match(/【(INPUT_IMAGE_EMPTY|NO_INLINE_IMAGE_FOUND|GEMINI_TIMEOUT|GEMINI_NETWORK|GEMINI_OVERLOADED|GEMINI_INTERNAL|GEMINI_UNKNOWN)】/);
  return (m?.[1] as GeminiDiagCode) || null;
}

const MAX_IMAGE_BYTES_PER_REQUEST = MAX_WORKFLOW_VISION_IMAGE_BYTES;

function parseInlineImageData(input: string): { mimeType: string; data: string } {
  const raw = (input || "").trim();
  const matched = raw.match(/^data:([^;,]+);base64,(.+)$/i);
  if (matched) {
    return {
      mimeType: matched[1] || "image/jpeg",
      data: matched[2] || "",
    };
  }
  return { mimeType: "image/jpeg", data: raw };
}

function base64Bytes(base64: string): number {
  const raw = (base64 || "").trim().replace(/\s+/g, "");
  if (!raw) return 0;
  const padding = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0;
  return Math.floor((raw.length * 3) / 4) - padding;
}


async function prepareInlineImageData(input: string): Promise<{ mimeType: string; data: string }> {
  const parsed = parseInlineImageData(input);
  if (!parsed.data) return parsed;
  if (base64Bytes(parsed.data) <= MAX_IMAGE_BYTES_PER_REQUEST) return parsed;
  const raw = (input || "").trim();
  const normalized = await normalizeDataUrlForVisionApi(raw, MAX_IMAGE_BYTES_PER_REQUEST);
  const compressedParsed = parseInlineImageData(normalized);
  if (dataUrlPayloadBytes(normalized) > MAX_IMAGE_BYTES_PER_REQUEST) {
    throw new Error(
      `检测用图仍超过 ${Math.round(MAX_IMAGE_BYTES_PER_REQUEST / (1024 * 1024))}MB，请缩小原图后重试`
    );
  }
  if (base64Bytes(compressedParsed.data) >= base64Bytes(parsed.data)) return parsed;
  return compressedParsed;
}

function collectInlineImagesFromGeminiResponse(response: any): string[] {
  const out: string[] = [];
  const candidates = Array.isArray(response?.candidates)
    ? response.candidates
    : Array.isArray(response?.response?.candidates)
      ? response.response.candidates
      : [];
  for (const c of candidates) {
    const parts = Array.isArray(c?.content?.parts) ? c.content.parts : [];
    for (const part of parts) {
      if (part?.inlineData?.data) {
        const mimeType = String(part.inlineData.mimeType || "image/png");
        out.push(`data:${mimeType};base64,${part.inlineData.data}`);
      }
    }
  }
  return out;
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isAgentPlatformImageModelId(registryId: string): boolean {
  const m = (registryId || '').trim().toLowerCase();
  if (!m) return false;
  if (m.includes('flash-image') || m.includes('pro-image') || m.includes('lite-image')) return true;
  return /-image$/.test(m);
}

function buildGeminiConfig<T extends Record<string, unknown>>(
  config: T,
  signal: AbortSignal,
  timeoutMs: number,
  meteringRegistryId?: string
): T {
  const nextHttpOptions = {
    ...((config.httpOptions as Record<string, unknown> | undefined) ?? {}),
    timeout: timeoutMs,
  };
  const registryId = (meteringRegistryId || '').trim();
  const withImageModalities =
    registryId && isAgentPlatformImageModelId(registryId) && !config.responseModalities
      ? ({ ...config, responseModalities: ['TEXT', 'IMAGE'] as const } as T)
      : config;
  return {
    ...withImageModalities,
    ...(registryId ? { __meteringRegistryId: registryId } : {}),
    abortSignal: signal,
    httpOptions: nextHttpOptions,
  };
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError('请求已取消'));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(createAbortError('请求已取消'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withGeminiRequestControl<T>(
  runner: (signal: AbortSignal) => Promise<T>,
  options?: GeminiRequestOptions
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS;
  const phase = options?.requestPhase;
  const controller = new AbortController();
  let timedOut = false;
  let externalAbortHandler: (() => void) | null = null;

  if (options?.abortSignal) {
    if (options.abortSignal.aborted) {
      throw createAbortError('请求已取消');
    }
    externalAbortHandler = () => controller.abort(createAbortError('请求已取消'));
    options.abortSignal.addEventListener('abort', externalAbortHandler, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(createAbortError(formatRequestTimeoutMessage(timeoutMs, phase)));
  }, timeoutMs);

  try {
    return await Promise.race([
      runner(controller.signal),
      new Promise<T>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(controller.signal.reason ?? createAbortError('请求已取消'));
        }, { once: true });
      })
    ]);
  } catch (error) {
    if (options?.abortSignal?.aborted) throw createAbortError('请求已取消');
    if (timedOut) throw new Error(buildDiagMessage("GEMINI_TIMEOUT", formatRequestTimeoutMessage(timeoutMs, phase)));
    if (isAbortError(error)) throw createAbortError('请求已取消');
    throw error;
  } finally {
    clearTimeout(timer);
    if (options?.abortSignal && externalAbortHandler) {
      options.abortSignal.removeEventListener('abort', externalAbortHandler);
    }
  }
}

export const DEFAULT_PROMPTS = {
  /** 对话生图：按指令修改图片时的系统提示（占位符 {instruction}） */
  edit: `[HIGH PRECISION EDITING PROTOCOL]
      Modify this image according to the user instruction with surgical accuracy.
      Maintain the core object's geometry, scale, and lighting consistency.
      Ensure the output is high-definition, sharp, and free of artifacts.
      Instruction: {instruction}`,
  dialog_understand: `You are an assistant that interprets the user's request. The user may have provided an image or only text.
- If the user provided an image: they may want (A) to describe/identify/answer a question about the image, or (B) to edit/modify/generate a new image from it.
- If the user provided NO image (text only): they may want to generate an image from the description (e.g. "画一只猫", "生成星空图", "a sunset over mountains"). In that case set shouldGenerateImage true and put the full image description in English in "instruction".
Output ONLY a valid JSON object (no markdown, no code fence) with these keys:
- "instruction" (required): if the user wants to edit or generate an image, give the exact prompt in English for the image model (full scene/object description for text-to-image); if they only ask to describe/identify, give a short English description of what to answer.
- "summary" (optional): short Chinese summary.
- "shouldGenerateImage" (required): true when the user clearly wants to edit, modify, or generate a new image (including text-only "draw X" / "画X" / "生成X"); false when they only ask to describe, identify, or answer a question about an existing image. When there is no image and the user describes a scene or asks to draw/generate, use true.`,
  /** 对话生图：纯文字描述生成图片时的系统提示（占位符 {instruction}） */
  dialog_text_to_image: `Generate a single high-quality image from the following description. Be faithful to the description: composition, style, subjects, and mood. Output only the image; no text.
Description: {instruction}`,
  detect_single: `Detect all distinct objects or regions in this image (people, animals, objects, background regions).
Return their bounding boxes in normalized coordinates [ymin, xmin, ymax, xmax] (0-1000).
Return as a JSON array of objects with 'id', 'label', and 'box_2d' keys.`,
  /** 切割图片用：识别大块内容区域（版面分块），不要识别每个小物体 */
  detect_blocks: `Identify the major content blocks or layout sections in this image (e.g. separate panels, diagram sections, distinct views, large coherent regions). Do NOT detect every small object (tiles, doors, figures); only return 3-12 bounding boxes for the main blocks that a human would use to "cut the image into separate pictures". Each block should be one logical unit (one view, one panel, one diagram). Return as a JSON array of objects with 'id', 'label', and 'box_2d' keys. Coordinates: [ymin, xmin, ymax, xmax] normalized 0-1000.`,
  /** 擂台：首轮写稿 — N=2/3/4 共用；具体 N 在请求用户段中给出 */
  arena_writer: `You are a prompt engineer for an image-generation model. The user has already uploaded ONE image and will give a short natural language description of what they want. Each prompt you output will be sent to the image model TOGETHER with that same uploaded image. Therefore every prompt MUST be an instruction to modify, transform, or edit THAT image (e.g. "transform this image into...", "based on this image, make it more...", "restyle the image to..."). Do NOT output standalone text-to-image prompts that describe a new scene from scratch and ignore the uploaded image.

The user's next message will state N (2, 3, or 4). You must output exactly N distinct alternative prompts in English. All must match the user's intent and differ in wording, style, or emphasis — each must clearly be an edit/transform instruction for the uploaded image.

First, in 1-3 sentences, briefly explain your reasoning and how you will create N distinct alternatives that all refer to modifying the uploaded image.

Output ONLY a valid JSON object with these keys (all strings):
- "reasoning": your short reasoning (required).
- "promptA", "promptB": always required.
- "promptC": required when N >= 3.
- "promptD": required when N = 4.
No markdown, no code fence, no other text.`,
  /** 擂台 V2：根据胜者提示词优化败者提示词。结合用户意图不跑偏、参考胜者优点、保留有意义差异；可选用户反馈败者差距与胜者优点。 */
  arena_optimize_loser: `You are a prompt engineer. You will receive: (1) a "winner" prompt the user preferred, (2) a "loser" prompt to improve, and optionally (3) the original user intent, (4) user-reported gaps in the loser (what was wrong with it), (5) user-reported strength of the winner (why it was chosen).

Rules:
- If "Original user intent" is provided: the improved prompt MUST align with it; do not drift to unrelated style or subject.
- If "User-reported gaps in the loser" is provided: address or avoid those issues in the improved prompt (e.g. less cluttered, clearer subject, different style, adjust detail level).
- If "User-reported strength of the winner" is provided: learn from or preserve that strength while keeping the improved prompt distinct.
- Learn from the winner's clarity, structure, or style where it helps, but keep the improved prompt DISTINCT from the winner (no copying). Preserve meaningful diversity where it does not conflict with user intent.
- If no user intent is given: infer the shared goal from the winner and loser prompts, then improve the loser toward that goal while still keeping it distinct from the winner.

Output a valid JSON object with two keys (both strings):
- "reasoning": 1-3 sentences explaining how you improved the loser (what you kept, what you learned from the winner, how you kept it distinct). Use the same language as the user intent if provided, else English.
- "prompt": the new English image-generation prompt (one line).
No markdown, no code fence, no other text.`,
  /** 擂台：根据全量信息生成一名新挑战者提示词（用户意图 + 当前擂主 + 已有全部提示词），并输出推理过程 */
  arena_new_challenger: `You are a prompt engineer. You will receive: (1) the original user intent, (2) the current champion (winner) prompt, (3) a list of all other prompts already seen in this arena. Your task: create ONE new image-generation prompt in English that serves as a new "challenger". It should align with user intent, learn from the champion's strengths, but be clearly distinct from the champion and from all existing prompts (do not repeat or copy). Aim for a prompt that could produce a different yet valid interpretation.

First, in 1-3 sentences, explain your reasoning: how you used the context and how your new prompt differs. Then output the new prompt.

Output ONLY a valid JSON object with keys (both strings):
- "reasoning": your short reasoning.
- "prompt": the new English image-generation prompt (one line).
No markdown, no code fence, no other text.`,
  /** 结构化复现：将一条生图提示词拆成主体/场景/风格/修饰，见 PROMPT_SCORING_DESIGN §6.1 */
/** 工作流能力：根据图片识别主体描述（变量部分），用于与固定提示词拼接后生图 */
  describe_subject: `Look at this image. Output ONLY a short English phrase describing the main subject or object in the image (what the image shows as the primary focus: object type, shape, posture, key visual traits). Do NOT include style, background, lighting, or quality terms. One line only, no period at the end. Example: "a ceramic vase with floral pattern" or "a character in armor holding a sword".`
};

/** 对话生图：收口函数，返回实际发给模型的完整 prompt；业务代码不直接拼字符串。 */
export function getEditPrompt(instruction: string, customTemplate?: string): string {
  const template = customTemplate || DEFAULT_PROMPTS.edit;
  return template.replace(/\{instruction\}/g, instruction);
}

function errorStringForRetry(err: unknown): string {
  if (err == null) return "";
  const m = (err as { message?: string })?.message;
  if (typeof m === "string" && m.length) return m;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isUpstreamRateLimitError(err: unknown): boolean {
  const raw = errorStringForRetry(err);
  if (!raw || isCreditsOrGateErrorText(raw)) return false;
  const mapped = mapRateLimitErrorText(raw);
  return Boolean(mapped && mapped.includes('Google/Vertex'));
}

/** 上游 429 客户端有限重试：走 AI Worker Proxy 时 proxy 已退避，客户端再补 1 次；直连 SDK 可 2 次 */
function upstreamRateLimitClientRetries(): number {
  try {
    return effectiveAiWorkerProxyBase() ? 1 : 2;
  } catch {
    return 2;
  }
}

function upstreamRateLimitRetryDelayMs(attempt: number): number {
  return Math.min(90_000, 35_000 + Math.max(0, attempt) * 25_000);
}

/** SDK 常以 code/status 抛出，不一定带 503 字符串（上游 429 由 callWithRetry 单独预算，不走本函数） */
function isRetryableError(err: unknown): boolean {
  if (isUpstreamRateLimitError(err)) return false;
  if (err != null && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const code = e.code;
    const status = e.status;
    if (code === 429 || status === "RESOURCE_EXHAUSTED") return false;
    if (code === 504 || code === 503 || code === 500) return true;
    if (status === "DEADLINE_EXCEEDED" || status === "UNAVAILABLE" || status === "RESOURCE_EXHAUSTED" || status === "INTERNAL") return true;
    if (typeof code === "string" && /UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED/i.test(code)) return true;
    const nested = e.error;
    if (nested && typeof nested === "object") {
      const n = nested as Record<string, unknown>;
      if (n.code === 429 || n.status === "RESOURCE_EXHAUSTED") return false;
      if (n.code === 504 || n.code === 503 || n.status === "DEADLINE_EXCEEDED" || n.status === "UNAVAILABLE") return true;
    }
  }
  const msg = errorStringForRetry(err);
  if (/too many requests/i.test(msg) || /\bRESOURCE_EXHAUSTED\b/i.test(msg)) return false;
  return (
    msg.includes("504") ||
    msg.includes("DEADLINE_EXCEEDED") ||
    msg.includes("Deadline expired") ||
    msg.includes("503") ||
    msg.includes("overloaded") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("high demand") ||
    msg.includes("500") ||
    msg.includes("INTERNAL") ||
    msg.includes("Internal error") ||
    msg.includes("The operation was cancelled") ||
    msg.includes("operation was canceled") ||
    msg.includes("CANCELLED")
  );
}

/** 生图：503/过载时重试；仅在未成功出图前重试，不重复计费成功结果 */
const IMAGE_GEN_RETRIES_ON_OVERLOAD = 8;
/** 工作流「理解→生图」：理解阶段在 AI Worker Proxy 代理下需等服务端多次 503 退避，外层超时不能太短 */
/** 工作流/能力（如转风格）调用 understand 时传入，不跳过理解、专抗 503 高峰 */
export const CAPABILITY_UNDERSTAND_RETRY_OPTIONS: GeminiRequestOptions = {
  timeoutMs: 90_000,
  retries: 1,
  retryDelayMs: 3000,
  maxRetryDelayMs: 8000,
  requestPhase: '理解',
};
const AI_WORKER_PROXY_UNDERSTAND_TIMEOUT_MS = 120_000;
const IMAGE_GEN_RETRY_DELAY_MS = 6000;
/** 走 AI Worker Proxy 异步代理时含轮询+服务端退避，总等待需长于单次 SDK 超时（与 Vertex 4K 档位对齐） */
const AI_WORKER_PROXY_IMAGE_TIMEOUT_MS = 600_000;

/** 外层 withGeminiRequestControl 不得短于 Vertex/AI Worker Proxy 内层 SDK 超时，否则会先被客户端掐断 */
function effectiveImageGenControlTimeoutMs(
  baseTimeout: number,
  useLongAiWorkerProxyWait: boolean,
  registryId: string,
  imageSize?: string
): number {
  let floor = baseTimeout;
  if (isLongImageSizeTier(imageSize) || useLongAiWorkerProxyWait || usesVertexProxyForImage(registryId)) {
    floor = Math.max(floor, GEMINI_VERTEX_IMAGE_TIMEOUT_MS);
  }
  if (usesOpenAiRouteForImage(registryId)) {
    floor = Math.max(floor, OPENAI_IMAGE_REQUEST_TIMEOUT_MS);
  }
  return useLongAiWorkerProxyWait ? Math.max(floor, AI_WORKER_PROXY_IMAGE_TIMEOUT_MS) : floor;
}

function shouldFallbackUnderstandToBrowserGemini(error: unknown): boolean {
  if (!AI_WORKER_PROXY_BASE) return false;
  if (pickChannel(DEFAULT_MODEL_TEXT, "text") !== "gemini-aistudio") return false;
  if (!getUserApiKey()) return false;
  const msg = String((error as Error)?.message ?? error ?? "");
  return (
    msg.includes("GEMINI_TIMEOUT") ||
    msg.includes("请求超时") ||
    msg.includes("Failed to fetch") ||
    msg.includes("fetch failed") ||
    msg.includes("NetworkError") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("DEADLINE_EXCEEDED") ||
    msg.includes("high demand")
  );
}

async function callWithRetry<T>(
  apiFn: (signal: AbortSignal) => Promise<T>,
  options?: GeminiRequestOptions
): Promise<T> {
  let retries = options?.retries ?? 3;
  let delay = options?.retryDelayMs ?? 2000;
  const maxRetryDelayMs = options?.maxRetryDelayMs ?? 15_000;
  const maxAttempts = retries + 1;
  let currentAttempt = 1;
  let rateLimitRetriesLeft = upstreamRateLimitClientRetries();
  let rateLimitAttempt = 0;

  for (;;) {
    try {
      return await withGeminiRequestControl(apiFn, options);
    } catch (err) {
      if (isAbortError(err)) throw err;
      if (isUpstreamRateLimitError(err)) {
        if (rateLimitRetriesLeft <= 0) throw err;
        const waitMs = upstreamRateLimitRetryDelayMs(rateLimitAttempt);
        const phase = options?.requestPhase ? `（${options.requestPhase}）` : '';
        console.warn(
          buildDiagMessage(
            'GEMINI_RATE_LIMIT',
            `Google/Vertex RPM 触顶${phase}，正在退避重试`,
            `约 ${Math.ceil(waitMs / 1000)} 秒后重试（剩余 ${rateLimitRetriesLeft} 次）`
          )
        );
        await sleepWithAbort(waitMs, options?.abortSignal);
        rateLimitRetriesLeft -= 1;
        rateLimitAttempt += 1;
        continue;
      }
      if (!(isRetryableError(err) && retries > 0)) {
        throw err;
      }
      const raw = String((err as Error)?.message ?? err);
      const code =
        extractDiagCode(raw) ||
        (/429|503|504|UNAVAILABLE|DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(raw)
          ? "GEMINI_OVERLOADED"
          : /500|INTERNAL|Internal error/i.test(raw)
            ? "GEMINI_INTERNAL"
            : /Failed to fetch|fetch failed|NetworkError|ECONNRESET|ETIMEDOUT/i.test(raw)
              ? "GEMINI_NETWORK"
              : "GEMINI_UNKNOWN");
      console.warn(
        buildDiagMessage(
          code,
          `Gemini 请求异常，准备重试（第 ${currentAttempt}/${maxAttempts} 次失败）`,
          `剩余重试 ${retries} 次，${delay}ms 后重试`
        )
      );
      await sleepWithAbort(delay, options?.abortSignal);
      retries -= 1;
      delay = Math.min(delay * 2, maxRetryDelayMs);
      currentAttempt += 1;
    }
  }
}

const GEMINI_PERMISSION_DENIED_HINT =
  "Google 已拒绝当前密钥对应项目的访问（403 PERMISSION_DENIED）。请到 Google AI Studio / Cloud Console 检查该项目是否欠费、违规受限或未开通 Gemini；或更换新的 API Key。若站点配置了后端生图代理（VITE_AI_WORKER_PROXY_API），请在服务器环境变量中使用有效的 GEMINI_API_KEY。";

/** 403 提示：按当前构建配置说明「实际用的是哪一把 Key」，避免用户只改设置页却无效 */
function geminiPermissionDeniedHintForBuild(): string {
  if (!AI_WORKER_PROXY_BASE) return GEMINI_PERMISSION_DENIED_HINT;
  if (preferBrowserGeminiKeyFirst()) {
    return (
      GEMINI_PERMISSION_DENIED_HINT +
      " 【说明】已配置后端代理，但当前构建启用了 VITE_USE_BROWSER_GEMINI_KEY_FIRST：优先使用设置页/本地的 Gemini Key；若你确定 Key 在 AI Studio 可用却仍 403，请把 Network 里失败请求的 URL 发管理员核对是否走了代理或其它域名。"
    );
  }
  return (
    GEMINI_PERMISSION_DENIED_HINT +
    " 【说明】当前构建已配置 VITE_AI_WORKER_PROXY_API 且默认优先走后端：Google 看到的是代理服务器上的 GEMINI_API_KEY，与设置页里的 Key 通常不是同一把；请在部署代理的环境（如 Render）里更换/核对密钥并重启服务。"
  );
}

/**
 * `tripoService` 抛错格式：`Tripo 创建任务失败 (502)：{...json...}`。
 * 若走 `normalizeApiErrorMessage` 的通用分支，会因 raw 含 `500` 被误映射成 Gemini 的笼统文案，故在此单独解析。
 */
function extractTripoProxyErrorDetail(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!/Tripo (创建任务|查询任务|上传图片)失败/i.test(s)) return null;
  const m = s.match(/\((\d{3})\)\s*[：:]\s*([\s\S]+)$/);
  const httpSt = m?.[1] || "";
  const tail = (m?.[2] || "").trim();
  if (!tail) {
    return httpSt
      ? `Tripo 接口返回 HTTP ${httpSt}（无响应体）。多为上游或网络问题，请稍后重试；持续失败可查 Tripo 状态或尝试其它模型版本。`
      : "Tripo 请求失败（无状态码）。请检查 auth-api 代理与 TRIPO_PROXY 配置后重试。";
  }
  try {
    const parsed = JSON.parse(tail) as Record<string, unknown>;
    const nestedErr =
      parsed.error && typeof parsed.error === "object"
        ? (parsed.error as Record<string, unknown>)
        : null;
    const msg =
      (typeof parsed.message === "string" && parsed.message.trim()) ||
      (typeof parsed.msg === "string" && parsed.msg.trim()) ||
      (nestedErr && typeof nestedErr.message === "string" && nestedErr.message.trim()) ||
      "";
    const bizCode =
      typeof parsed.code === "number"
        ? parsed.code
        : nestedErr && typeof nestedErr.code === "number"
          ? (nestedErr.code as number)
          : undefined;
    const parts: string[] = [];
    if (bizCode != null) parts.push(`业务码 ${bizCode}`);
    if (msg) parts.push(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
    if (parts.length) {
      const hint =
        httpSt === "500" || httpSt === "502" || httpSt === "503"
          ? "（多为 Tripo 上游短暂异常，可稍后重试、换模型版本，或查看 api.tripo3d.ai 公告）"
          : "";
      return `Tripo：HTTP ${httpSt || "?"}，${parts.join("，")}${hint}`;
    }
    /** 上游返回可解析 JSON 但无 message/code（常见为 500 + `{}`） */
    const meaningfulKeys = Object.keys(parsed).filter((k) => {
      const v = parsed[k];
      if (v == null) return false;
      if (typeof v === "object") return Object.keys(v as object).length > 0;
      return String(v).trim() !== "";
    });
    if (meaningfulKeys.length === 0 && (httpSt === "500" || httpSt === "502" || httpSt === "503")) {
      return `Tripo：HTTP ${httpSt}（上游未返回具体错误字段，多为服务端短暂故障或网关超时）。请稍后重试；可尝试换 model_version（如 v3.0-20250812 / v2.5-20250123）、降低面数或暂时关闭 PBR；仍持续时请向 Tripo 支持反馈并附发生时间。`;
    }
    if (meaningfulKeys.length === 0 && /^4\d\d$/.test(httpSt)) {
      return `Tripo：HTTP ${httpSt}（响应体无有效报错字段）。请核对 API Key、请求参数与图片格式；仍失败可把 Network 里 /api/tripo 的响应体发给管理员。`;
    }
  } catch {
    /* 非 JSON 尾段，走下方原文缩写 */
  }
  const compact = tail.length > 160 ? tail.slice(0, 160) + "…" : tail;
  if (compact === "{}" && (httpSt === "500" || httpSt === "502" || httpSt === "503")) {
    return `Tripo：HTTP ${httpSt}（响应体为空对象）。多为 Tripo 侧内部错误，请稍后重试或更换模型版本。`;
  }
  return `Tripo：HTTP ${httpSt || "?"} — ${compact}`;
}

function parseGoogleStyleErrorPayload(raw: string): { code?: number; status?: string; message?: string } | null {
  const s = String(raw || "").trim();
  const tryParse = (t: string) => {
    try {
      const parsed = JSON.parse(t) as {
        error?: { code?: number; status?: string; message?: string };
        code?: number;
        status?: string;
        message?: string;
      };
      const nested = parsed?.error;
      if (nested && typeof nested === "object") {
        return {
          code: typeof nested.code === "number" ? nested.code : undefined,
          status: typeof nested.status === "string" ? nested.status : undefined,
          message: typeof nested.message === "string" ? nested.message : undefined,
        };
      }
      return {
        code: typeof parsed?.code === "number" ? parsed.code : undefined,
        status: typeof parsed?.status === "string" ? parsed.status : undefined,
        message: typeof parsed?.message === "string" ? parsed.message : undefined,
      };
    } catch {
      return null;
    }
  };
  const direct = tryParse(s);
  if (direct && (direct.code != null || direct.status || direct.message)) return direct;
  const i = s.indexOf('{"error"');
  if (i >= 0) {
    const sub = tryParse(s.slice(i));
    if (sub && (sub.code != null || sub.status || sub.message)) return sub;
  }
  return null;
}

/** 429 / 限流类错误 → 工作区可读文案（重试耗尽后） */
export function userFacingRateLimitMessage(kind: 'upstream' | 'site' = 'upstream'): string {
  if (kind === 'site') {
    return '生图在本站公平队列中受限，请等待约 10～30 秒后清空队列、单次重试。';
  }
  let msg =
    'Google/Vertex API 配额或 RPM 触顶（非积分不足）。已自动退避重试仍未恢复；请等待 1～3 分钟后单次重试，或减少队列并发；生图可在快捷栏选「直发」跳过理解步。';
  try {
    if (import.meta.env.DEV && isLocalDevPage()) {
      msg +=
        ' 本地 dev 默认经 Render 共享 ai-worker-proxy（与他人共用 Google 配额）；若仅自己调试仍频繁 429，可在 .env.local 设 VITE_AI_WORKER_PROXY_API=same-origin 并本机 npm run dev:ai-worker-proxy（需 VERTEX_PROJECT_ID）。';
    }
  } catch {
    /* ignore */
  }
  return msg;
}

function userFacingUpstreamAccountCreditMessage(raw: string): string | null {
  const t = (raw || '').trim();
  if (!t) return null;
  if (/prepayment credits? (are )?depleted|billing account|insufficient.*(balance|credit)|quota.*depleted/i.test(t)) {
    return 'Google/Vertex 上游账户预付额度或结算余额已耗尽。请管理员到 Google AI Studio / Google Cloud 检查余额、账单和配额；这不是本站积分不足，也不是等待几分钟就一定恢复的短时限流。';
  }
  return null;
}

function userFacingVolcengineArkRateLimitMessage(raw: string): string | null {
  const t = (raw || '').trim();
  if (!t) return null;
  if (!/Volcengine Ark|volcengine|volces|火山方舟|方舟|doubao|seedream|seedance|seed3d/i.test(t)) return null;
  if (
    !/\bHTTP\s*429\b|\bstatus\s*429\b|"code"\s*:\s*429\b|too many requests|reached the set inference limit|inference limit|rate limit|RESOURCE_EXHAUSTED/i.test(
      t
    )
  ) {
    return null;
  }
  return '火山方舟/Ark 推理限流或账号并发额度触顶。请等待一段时间后单次重试，或在火山方舟控制台提升/调整推理限额；这不是 Google/Vertex 配额。';
}

function isCreditsOrGateErrorText(raw: string): boolean {
  return /CREDITS_RESERVE_INVALID|CREDITS_EXCEEDED|CREDITS_BUNDLE|CREDITS_GATE|积分预扣|积分不足|积分准入|LOGIN_REQUIRED|请先登录/i.test(
    raw
  );
}

export function mapRateLimitErrorText(raw: string): string | null {
  const t = (raw || '').trim();
  if (!t || isCreditsOrGateErrorText(t)) return null;
  if (detectPipelineStepFromMessage(t)) return null;
  /** UUID / reserveKey 中含 429 子串，非 Google 限流 */
  if (/proxy:[0-9a-f-]{20,}/i.test(t) && !/too many requests|resource_exhausted|rate_limited/i.test(t)) {
    return null;
  }
  const arkRateLimit = userFacingVolcengineArkRateLimitMessage(t);
  if (arkRateLimit) return arkRateLimit;
  const accountCredit = userFacingUpstreamAccountCreditMessage(t);
  if (accountCredit) return accountCredit;
  if (/too many requests/i.test(t)) return userFacingRateLimitMessage('upstream');
  if (/\bHTTP\s*429\b/i.test(t) || /\bstatus\s*429\b/i.test(t)) return userFacingRateLimitMessage('upstream');
  if (/"code"\s*:\s*429\b/.test(t) || /\berror\.code\s*[=:]\s*429\b/i.test(t)) {
    return userFacingRateLimitMessage('upstream');
  }
  if (/\bRESOURCE_EXHAUSTED\b/i.test(t) || /\bresource_exhausted\b/i.test(t)) {
    return userFacingRateLimitMessage('upstream');
  }
  if (/\brate_limited\b/i.test(t)) return userFacingRateLimitMessage('site');
  if (/请求过于频繁/.test(t) && !/用量上报|登录尝试|注册|邀请码/.test(t)) {
    return userFacingRateLimitMessage('site');
  }
  if (/\brate limit\b/i.test(t)) return userFacingRateLimitMessage('upstream');
  return null;
}

/** 将 API 返回的原始错误转为用户可读的简短说明（用于界面展示） */
function aiGatewayStructuredErrorMessage(err: unknown): string | null {
  const obj = err && typeof err === 'object' ? (err as any) : null;
  const payload = obj?.payload && typeof obj.payload === 'object' ? obj.payload : null;
  const code = String(obj?.code || payload?.code || payload?.error || '').trim();
  if (code !== 'AI_GATEWAY_PROVIDER_PAUSED') return null;
  const details = payload?.details && typeof payload.details === 'object' ? payload.details : null;
  let providerIds = Array.isArray(details?.providerIds)
    ? details.providerIds.map((item: unknown) => String(item || '').trim()).filter(Boolean)
    : [];
  if (!providerIds.length) {
    const backendMessage = String(payload?.message || obj?.message || '');
    const matched = backendMessage.match(/paused by ops control:\s*([^。；;\n]+)/i);
    if (matched?.[1]) {
      providerIds = matched[1].split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  const suffix = providerIds.length ? `（${providerIds.join('、')}）` : '';
  return `供应商通道已被运营暂停${suffix}，请在供应商中心的 Gateway 运营控制中清空暂停供应商，或切换到其他已发布模型。`;
}

export function normalizeApiErrorMessage(err: unknown): string {
  const earlyRaw = String((err as any)?.message ?? err);
  if (/terminated|connection terminated|UND_ERR_SOCKET|other side closed|ECONNRESET|ETIMEDOUT/i.test(earlyRaw)) {
    return "生图连接中断，系统已尽量重试。请单次重试；如果仍失败，请先把参考图缩小或减少参考图数量后再生成 4K。";
  }
  if (isAiPipelineStepError(err)) return err.message;
  const structuredGatewayMessage = aiGatewayStructuredErrorMessage(err);
  if (structuredGatewayMessage) return structuredGatewayMessage;
  const raw = String((err as any)?.message ?? err);
  if (/terminated|connection terminated|UND_ERR_SOCKET|other side closed|ECONNRESET|ETIMEDOUT/i.test(raw)) {
    return "生图连接中断，系统已尽量重试。请单次重试；如果仍失败，请先把参考图缩小或减少参考图数量后再生成 4K。";
  }
  if (detectPipelineStepFromMessage(raw)) return raw;
  if (/Volcengine Ark rejected AI job handoff/i.test(raw) && /real person|contain real person|真人|人像/i.test(raw)) {
    return '火山方舟已拒绝本次视频任务：输入图可能包含真人/人像，触发了上游安全策略。秘钥和本地链路不一定有问题；请换一张非真人输入图，或切换到支持该场景的供应商/模型后重试。';
  }
  if (/maximum call stack size exceeded/i.test(raw)) {
    return '执行时发生内部栈溢出（多为模块循环依赖或图片过大）。请硬刷新页面后重试；若仍失败请打开浏览器控制台查看 stack 并反馈。';
  }
  if (/CREDITS_RESERVE_INVALID|积分预扣无效|积分预扣.*过期/i.test(raw)) {
    return '积分预扣已失效或已被上一轮任务占用，请刷新页面后单次重试（勿连点队列）。';
  }
  if (/CREDITS_EXCEEDED|积分不足/i.test(raw)) {
    return raw.length < 120 && /积分不足/.test(raw) ? raw : '积分不足，无法完成本次 AI 任务。';
  }
  if (/LOGIN_REQUIRED|请先登录后再使用 AI 生成/i.test(raw)) {
    if (import.meta.env.DEV && isLocalDevPage()) {
      return '请先登录后再使用 AI 生成。本地调试时若已登录，请确认 .env.local 里的 AUTH_API_BASE 与 VITE_AUTH_API_BASE_URL 指向同一个 auth-api，并重启 npm run dev:ai-worker-proxy 后硬刷新页面。';
    }
    return '请先登录后再使用 AI 生成。';
  }
  if (/CREDITS_BUNDLE_INVALID|CREDITS_BUNDLE_UNAVAILABLE|积分预扣未返回|无法连接.*积分/.test(raw)) {
    return raw.length < 160 ? raw : '无法连接积分预扣服务，请确认已登录且 auth-api 可用后重试。';
  }
  const accountCredit = userFacingUpstreamAccountCreditMessage(raw);
  if (accountCredit) return accountCredit;
  const rateLimit = mapRateLimitErrorText(raw);
  if (rateLimit) {
    logAiPipelineDev('map', { raw, mapped: rateLimit });
    try {
      if (import.meta.env.DEV && raw !== rateLimit) {
        console.warn('[assetcutter] 限流类错误映射（原始）：', raw.slice(0, 400));
      }
    } catch {
      /* ignore */
    }
    const excerpt =
      raw && raw !== rateLimit && raw.length < 220
        ? `（原始：${raw}）`
        : raw && raw !== rateLimit
          ? `（原始：${raw.slice(0, 120)}…）`
          : '';
    return rateLimit + excerpt;
  }
  const vertexUser = userMessageForVertexProxyNotReady(raw);
  if (vertexUser) {
    try {
      if (import.meta.env.DEV && raw.length > 80) {
        console.warn("[assetcutter] Vertex 代理返回（节选）：", raw.slice(0, 400));
      }
    } catch {
      /* ignore */
    }
    return vertexUser;
  }
  const diagCode = extractDiagCode(raw);
  if (diagCode) {
    const compact = raw.replace(/【[^】]+】/g, '').trim();
    return compact.length > 140 ? compact.slice(0, 140) + "…" : compact;
  }
  /** 浏览器 fetch 失败时 message 多为纯「Failed to fetch」，未必带「TypeError:」前缀 */
  if (/failed to fetch|fetch failed|networkerror|load failed/i.test(raw)) {
    try {
      if (import.meta.env.DEV) {
        console.warn(
          "[assetcutter] 网络请求失败（其它模块）。若为生图：已单独在控制台提示代理/端口；此处为通用排障入口。"
        );
      }
    } catch {
      /* ignore */
    }
    return "无法连接服务器，请检查网络后重试。";
  }

  const tripoDetail = extractTripoProxyErrorDetail(raw);
  if (tripoDetail) return tripoDetail;

  const googleErr = parseGoogleStyleErrorPayload(raw);
  if (googleErr) {
    const { code, status, message } = googleErr;
    if (code === 403 || status === "PERMISSION_DENIED" || /denied access/i.test(String(message || ""))) {
      return geminiPermissionDeniedHintForBuild();
    }
    if (code === 500 || status === "INTERNAL") {
      return "服务暂时异常 (500)，请稍后重试";
    }
    if (code === 504 || status === "DEADLINE_EXCEEDED") {
      return "生图请求超时（504），系统已自动重试；请稍后再试";
    }
    if (code === 503 || status === "UNAVAILABLE") {
      return "生图模型当前繁忙（503），系统已自动重试；请稍后再试";
    }
    if (typeof message === "string" && message.length > 0 && message.length < 200) return message;
  }

  if (/Please use a valid role:\s*user\s*model/i.test(raw)) {
    return (
      '网关拒绝了对话请求的「角色」格式（常见于部分 Gemini 兼容线路）。请更新本站代码后重试；若仍失败可暂时改用 Google Gemini / Vertex 官方代理，或向网关服务商反馈。'
    );
  }
  if (/valid stable user model/i.test(raw)) {
    return (
      '上游提示模型不可用（常见于 VectorEngine 等对预览模型 id 限制）。已在向量引擎线路自动改用 gemini-2.5-flash / gemini-2.5-pro；若仍失败请在设置中更换供应商或核对订阅/额度。'
    );
  }

  if (/PERMISSION_DENIED/i.test(raw) || /"code"\s*:\s*403/.test(raw) || /denied access/i.test(raw)) {
    return geminiPermissionDeniedHintForBuild();
  }

  try {
    const parsed = JSON.parse(raw);
    const code = parsed?.error?.code ?? parsed?.code;
    const message = parsed?.error?.message ?? parsed?.message ?? raw;
    if (code === 500 || parsed?.error?.status === "INTERNAL") {
      return "服务暂时异常 (500)，请稍后重试";
    }
    if (code === 504 || parsed?.error?.status === "DEADLINE_EXCEEDED") {
      return "生图请求超时（504），系统已自动重试；请稍后再试";
    }
    if (code === 503 || parsed?.error?.status === "UNAVAILABLE") {
      return "生图模型当前繁忙（503），系统已自动重试；请稍后再试";
    }
    if (typeof message === "string" && message.length < 120) return message;
    return raw.slice(0, 100) + (raw.length > 100 ? "…" : "");
  } catch {
    if (raw.includes("500") || raw.includes("INTERNAL") || raw.includes("Internal error")) {
      return "服务暂时异常 (500)，请稍后重试";
    }
    return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
  }
}

/**
 * OpenAI 兼容网关（Antigravity / 部分 ToAPIs）在 `json_object` 模式下仍可能返回 ```json … ``` 包裹的文本；
 * 官方 Gemini structured output 多为裸 JSON。此处统一剥围栏并尽量截取首个 `[`…`]` 数组再 parse。
 */
function parseBoundingBoxJsonArrayFromModelText(raw: string): unknown[] {
  const t = (raw || "").trim();
  if (!t) return [];
  let s = t;
  const fenced = s.match(/```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```/i);
  if (fenced) {
    s = fenced[1].trim();
  } else if (/^```(?:json)?/i.test(s)) {
    s = s
      .replace(/^```(?:json)?\s*\r?\n?/i, "")
      .replace(/\r?\n?```\s*$/i, "")
      .trim();
  }
  const tryArray = (json: string): unknown[] => {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  };
  try {
    return tryArray(s);
  } catch {
    const i = s.indexOf("[");
    const j = s.lastIndexOf("]");
    if (i >= 0 && j > i) {
      try {
        return tryArray(s.slice(i, j + 1));
      } catch {
        /* fall through */
      }
    }
    throw new Error(
      "模型返回无法解析为 JSON 数组（可能被 markdown 代码块或说明文字包裹；可换网关或收紧提示词）。"
    );
  }
}

function parseJsonObjectFromModelText(raw: string): Record<string, unknown> {
  const t = (raw || "").trim();
  if (!t) return {};
  let s = t;
  const fenced = s.match(/```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```/i);
  if (fenced) {
    s = fenced[1].trim();
  } else if (/^```(?:json)?/i.test(s)) {
    s = s
      .replace(/^```(?:json)?\s*\r?\n?/i, "")
      .replace(/\r?\n?```\s*$/i, "")
      .trim();
  }
  const tryObject = (json: string): Record<string, unknown> => {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  };
  try {
    return tryObject(s);
  } catch {
    const i = s.indexOf("{");
    const j = s.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        return tryObject(s.slice(i, j + 1));
      } catch {
        /* fall through */
      }
    }
    throw new Error("模型返回无法解析为 JSON 对象");
  }
}

export type StoryboardSheetStructureAnalysisRaw = {
  shotCount: number;
  cols: number;
  rows: number;
  shotNos: string[];
  emptyCellCount: number;
};

export function buildStoryboardSheetStructureAnalysisPrompt(): string {
  return `你是分镜表拼图结构分析助手。请阅读整张分镜拼图页，只输出 JSON 对象（不要 markdown、不要解释）。

请回答：
1. shotCount：有效分镜格数量（有插画/草图内容的格；空白占位格、打叉格不算）；
2. cols / rows：规整网格的列数与行数（如 4 行 4 列填 rows=4, cols=4）；
3. shotNos：每个有效分镜格的镜号，按从左到右、从上到下顺序（从格顶栏读取，如「1 | 全景 | 4s」→ "001"；数字镜号统一三位）；
4. emptyCellCount：网格中空白/占位格数量。

注意：
- 不要重复计数顶栏缩略图条（若存在）；
- shotNos 长度必须等于 shotCount；
- cols * rows 应 ≥ shotCount + emptyCellCount。`;
}

/** 视觉模型先分析分镜拼图结构（镜数、行列、镜号），供后续切分框定位 */
export async function analyzeStoryboardSheetStructureInImage(
  base64Image: string,
  model = DEFAULT_MODEL_TEXT,
  options?: GeminiRequestOptions
): Promise<StoryboardSheetStructureAnalysisRaw | null> {
  return callWithRetry(async (signal) => {
    const ai = getAI();
    const prompt = buildStoryboardSheetStructureAnalysisPrompt();
    const resolvedModel = resolveUpstreamTextModelId(model);
    const response = await ai.models.generateContent({
      model: resolvedModel,
      contents: [
        {
          role: 'user' as const,
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: base64Image.split(',')[1] || base64Image } },
          ],
        },
      ],
      config: buildGeminiConfig({
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            shotCount: { type: Type.NUMBER },
            cols: { type: Type.NUMBER },
            rows: { type: Type.NUMBER },
            shotNos: { type: Type.ARRAY, items: { type: Type.STRING } },
            emptyCellCount: { type: Type.NUMBER },
          },
          required: ["shotCount", "cols", "rows", "shotNos", "emptyCellCount"],
        },
      }, signal, options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS, model),
    });
    const obj = parseJsonObjectFromModelText(response.text || "");
    const shotCount = Number(obj.shotCount);
    const cols = Number(obj.cols);
    const rows = Number(obj.rows);
    const emptyCellCount = Number(obj.emptyCellCount);
    const shotNos = Array.isArray(obj.shotNos)
      ? obj.shotNos.map((item) => String(item ?? '').trim()).filter(Boolean)
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
  }, options).catch(() => null);
}

/** 单图物体检测，返回边界框（归一化 0-1000） */
export async function detectObjectsInImage(base64Image: string, model = DEFAULT_MODEL_TEXT, customPrompt?: string, options?: GeminiRequestOptions) {
  return callWithRetry(async (signal) => {
    const ai = getAI();
    const prompt = customPrompt || DEFAULT_PROMPTS.detect_single;
    const resolvedModel = resolveUpstreamTextModelId(model);
    const inline = await prepareInlineImageData(base64Image);
    const response = await ai.models.generateContent({
      model: resolvedModel,
      contents: [
        {
          role: 'user' as const,
          parts: [
            { text: prompt },
            { inlineData: { mimeType: inline.mimeType || 'image/jpeg', data: inline.data } },
          ],
        },
      ],
      config: buildGeminiConfig({
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              label: { type: Type.STRING },
              box_2d: { type: Type.ARRAY, items: { type: Type.NUMBER } }
            },
            required: ["id", "label", "box_2d"]
          }
        }
      }, signal, options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS, model)
    });
    const results = parseBoundingBoxJsonArrayFromModelText(response.text || "");
    return results.map((r) => {
      const box = r as { id: string; label: string; box_2d: number[] };
      return {
        id: box.id,
        label: box.label,
        ymin: box.box_2d[0],
        xmin: box.box_2d[1],
        ymax: box.box_2d[2],
        xmax: box.box_2d[3]
      };
    });
  }, options);
}

/**
 * 识别图片中的主体，输出一句英文描述（用于工作流能力「变量部分」与固定提示词拼接后生图）。
 */
export async function describeImageSubject(
  base64Image: string,
  model = DEFAULT_MODEL_TEXT,
  customPrompt?: string,
  options?: GeminiRequestOptions
): Promise<string> {
  const text = await callWithRetry(async (signal) => {
    const ai = getAI();
    const prompt = customPrompt || DEFAULT_PROMPTS.describe_subject;
    const resolvedModel = resolveUpstreamTextModelId(model);
    const response = await ai.models.generateContent({
      model: resolvedModel,
      contents: [
        {
          role: 'user' as const,
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64Image.split(',')[1] || base64Image } },
            { text: prompt },
          ],
        },
      ],
      config: buildGeminiConfig({}, signal, options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS, model)
    });
    const raw = (response.text || '').trim();
    if (!raw) throw new Error('Empty subject description');
    return raw.replace(/\n+/g, ' ').trim();
  }, options);
  return text;
}

// ---------- 对话式生图模块 ----------

/**
 * 用文本模型理解用户对图片的修改需求，输出 JSON 格式生图指令。
 * @returns 解析后的对象，至少含 instruction 字符串；解析失败时返回 { instruction: rawText }
 */
export async function understandImageEditIntent(
  imageBase64: string | string[] | null,
  userPrompt: string,
  model = DEFAULT_MODEL_TEXT,
  customPrompt?: string,
  options?: GeminiRequestOptions
): Promise<{ instruction: string; summary?: string; shouldGenerateImage?: boolean }> {
  const innerTimeout = options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS;
  const capabilityScale = (options?.retries != null && options.retries > 6) || Boolean(effectiveAiWorkerProxyBase());
  const controlTimeout = capabilityScale
    ? Math.max(innerTimeout, AI_WORKER_PROXY_UNDERSTAND_TIMEOUT_MS)
    : innerTimeout;
  const resolvedModel = resolveUpstreamTextModelId(model);
  const runUnderstand = async (
    strategy: "default" | "browser_google",
    overrideOptions?: GeminiRequestOptions
  ): Promise<string> =>
    callWithRetry(
      async (signal) => {
        const ai =
          strategy === "browser_google"
            ? withStrippedClientConfig(new GoogleGenAI({ apiKey: getUserApiKey()! }) as unknown as GeminiClientLike)
            : getAI();
        const systemPrompt = customPrompt || DEFAULT_PROMPTS.dialog_understand;
        const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
          {
            text: `User request: ${userPrompt}\n\nOutput only a valid JSON object with "instruction" (required), optional "summary", and "shouldGenerateImage" (required, true only when user wants to edit/generate a new image):`,
          },
        ];
        const images = Array.isArray(imageBase64) ? imageBase64.filter(Boolean) : imageBase64 ? [imageBase64] : [];
        for (let i = images.length - 1; i >= 0; i--) {
          const parsed = await prepareInlineImageData(images[i]);
          parts.unshift({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
        }
        const timeoutForThisRun =
          overrideOptions?.timeoutMs ?? (strategy === "browser_google" ? innerTimeout : controlTimeout);
        const response = await ai.models.generateContent({
          model: resolvedModel,
          contents: [{ role: 'user' as const, parts }],
          config: buildGeminiConfig({ systemInstruction: systemPrompt }, signal, timeoutForThisRun, model),
        });
        const text = response.text?.trim();
        if (!text) throw new Error("Empty understanding response");
        return text;
      },
      {
        ...options,
        timeoutMs: controlTimeout,
        requestPhase: options?.requestPhase ?? '理解',
        retries:
          options?.retries ??
          (effectiveAiWorkerProxyBase() ? 1 : 3),
        retryDelayMs: options?.retryDelayMs ?? (effectiveAiWorkerProxyBase() ? 6000 : 2000),
        ...overrideOptions,
      }
    );

  let raw: string;
  try {
    raw = await runUnderstand("default");
  } catch (error) {
    if (!shouldFallbackUnderstandToBrowserGemini(error)) {
      throw error;
    }
    console.warn(
      "understandImageEditIntent: AI Worker Proxy slow/unavailable, fallback to browser Gemini key for understanding."
    );
    raw = await runUnderstand("browser_google", {
      timeoutMs: Math.min(innerTimeout, 45_000),
      retries: 1,
      retryDelayMs: 1200,
      maxRetryDelayMs: 2000,
    });
  }
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    const instruction = typeof obj.instruction === 'string' ? obj.instruction : raw;
    const shouldGenerateImage = obj.shouldGenerateImage === true;
    return { instruction, summary: obj.summary, shouldGenerateImage };
  } catch {
    return { instruction: raw, shouldGenerateImage: false };
  }
}

/**
 * 根据指令生图：支持「图+指令」修改图，或「仅文字」文生图。
 * @param imageBase64 源图 base64；为 null 时仅根据 instruction 文生图
 * @param instruction 生图指令（可由 understandImageEditIntent 得到）
 * @param model 生图模型
 * @param options aspectRatio / imageSize 可选
 */
export async function dialogGenerateImage(
  imageBase64: string | null,
  instruction: string,
  model = DEFAULT_MODEL_IMAGE,
  options?: { aspectRatio?: string; imageSize?: string },
  customSystemPrompt?: string,
  abortSignal?: AbortSignal,
  requestOptions?: Omit<GeminiRequestOptions, 'abortSignal'>
): Promise<string> {
  const baseTimeout = requestOptions?.timeoutMs ?? GEMINI_IMAGE_REQUEST_TIMEOUT_MS;
  const useAiWorkerProxyImageQueue = shouldUseAiWorkerProxyImageQueueForModel(model);
  const controlTimeoutMs = effectiveImageGenControlTimeoutMs(
    baseTimeout,
    useAiWorkerProxyImageQueue,
    model,
    options?.imageSize
  );
  // 429/503/UNAVAILABLE 等自动退避重试；成功返回图片后不会再次请求。
  return callWithRetry(async (signal) => {
    const ai = getAIForImageModel(model);
    const isTextToImage = !imageBase64;
    const systemInstruction = (customSystemPrompt || (isTextToImage ? DEFAULT_PROMPTS.dialog_text_to_image : DEFAULT_PROMPTS.edit)).replace('{instruction}', instruction);
    const timeoutMs = imageGenTimeoutMsForModel(model, baseTimeout, options?.imageSize);
    const config: { systemInstruction: string; imageConfig?: { aspectRatio?: string; imageSize?: string } } = {
      systemInstruction
    };
    if (options?.aspectRatio || options?.imageSize) {
      config.imageConfig = {};
      if (options.aspectRatio) config.imageConfig.aspectRatio = options.aspectRatio;
      if (options.imageSize) config.imageConfig.imageSize = options.imageSize;
    }
    const sourceImage = imageBase64 || "";
    const inlineImage = !isTextToImage ? await prepareInlineImageData(sourceImage) : null;
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = isTextToImage
      ? [{ text: instruction }]
      : [
          { inlineData: inlineImage! },
          { text: instruction }
        ];
    if (!isTextToImage) {
      const first = parts[0] as { inlineData?: { mimeType: string; data: string } };
      if (!first.inlineData?.data) {
        throw new Error(buildDiagMessage("INPUT_IMAGE_EMPTY", "输入图片为空或 base64 无效"));
      }
    }
    const resolvedImageModel = resolveUpstreamImageModelIdForRegistry(model);
    const payload = {
      model: resolvedImageModel,
      contents: [{ role: 'user' as const, parts }],
      config: buildGeminiConfig(config, signal, timeoutMs, model),
    };
    const response = await ai.models.generateContent(payload);
    const images = collectInlineImagesFromGeminiResponse(response);
    if (images.length > 0) {
      return images[0];
    }
    const textPart = response.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text);
    const hint = textPart?.text?.slice(0, 120) ? `（模型返回了文字: ${String(textPart.text).slice(0, 120)}…）` : '（当前模型可能不支持图像输出，请换用其它生图模型）';
    throw new Error(buildDiagMessage("NO_INLINE_IMAGE_FOUND", `生图未返回图片${hint}`));
  }, {
    ...requestOptions,
    abortSignal,
    timeoutMs: controlTimeoutMs,
    requestPhase: requestOptions?.requestPhase ?? '生图',
    retries: requestOptions?.retries ?? IMAGE_GEN_RETRIES_ON_OVERLOAD,
    retryDelayMs: requestOptions?.retryDelayMs ?? IMAGE_GEN_RETRY_DELAY_MS,
  });
}

export async function dialogGenerateImageMulti(
  imagesBase64: string[],
  instruction: string,
  model = DEFAULT_MODEL_IMAGE,
  options?: { aspectRatio?: string; imageSize?: string },
  abortSignal?: AbortSignal,
  requestOptions?: Omit<GeminiRequestOptions, 'abortSignal'>
): Promise<string> {
  if (imagesBase64.length === 0) throw new Error('多图生图至少需要一张图片');
  const modelId = coerceImageModelRegistryId(model);
  const baseTimeout = requestOptions?.timeoutMs ?? GEMINI_IMAGE_REQUEST_TIMEOUT_MS;
  const useAiWorkerProxyImageQueue = shouldUseAiWorkerProxyImageQueueForModel(modelId);
  const controlTimeoutMs = effectiveImageGenControlTimeoutMs(
    baseTimeout,
    useAiWorkerProxyImageQueue,
    modelId,
    options?.imageSize
  );
  return callWithRetry(async (signal) => {
    const ai = getAIForImageModel(modelId);
    const systemInstruction = (DEFAULT_PROMPTS.edit || '').replace('{instruction}', instruction);
    const timeoutMs = imageGenTimeoutMsForModel(modelId, baseTimeout, options?.imageSize);
    const config: { systemInstruction: string; imageConfig?: { aspectRatio?: string; imageSize?: string } } = {
      systemInstruction
    };
    if (options?.aspectRatio || options?.imageSize) {
      config.imageConfig = {};
      if (options?.aspectRatio) config.imageConfig.aspectRatio = options.aspectRatio;
      if (options?.imageSize) config.imageConfig.imageSize = options.imageSize;
    }
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    for (const img of imagesBase64) {
      parts.push({ inlineData: await prepareInlineImageData(img) });
    }
    if (parts.some((p) => "inlineData" in p && !p.inlineData?.data)) {
      throw new Error(buildDiagMessage("INPUT_IMAGE_EMPTY", "多图输入中存在空图片或无效 base64"));
    }
    parts.push({ text: instruction });
    const resolvedImageModel = resolveUpstreamImageModelIdForRegistry(modelId);
    const response = await ai.models.generateContent({
      model: resolvedImageModel,
      contents: [{ role: 'user' as const, parts }],
      config: buildGeminiConfig(config, signal, timeoutMs, modelId)
    });
    const images = collectInlineImagesFromGeminiResponse(response);
    if (images.length > 0) {
      return images[0];
    }
    const textPart = response.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text);
    const hint = textPart?.text?.slice(0, 120) ? `（模型返回了文字: ${String(textPart.text).slice(0, 120)}…）` : '（当前模型可能不支持图像输出）';
    throw new Error(buildDiagMessage("NO_INLINE_IMAGE_FOUND", `生图未返回图片${hint}`));
  }, {
    ...requestOptions,
    abortSignal,
    timeoutMs: controlTimeoutMs,
    requestPhase: requestOptions?.requestPhase ?? '生图',
    retries: requestOptions?.retries ?? IMAGE_GEN_RETRIES_ON_OVERLOAD,
    retryDelayMs: requestOptions?.retryDelayMs ?? IMAGE_GEN_RETRY_DELAY_MS,
  });
}

export async function getDialogTextResponse(
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> }>,
  model = DEFAULT_MODEL_TEXT,
  options?: GeminiRequestOptions
): Promise<string> {
  const resolvedModel = resolveUpstreamTextModelId(model);
  return callWithRetry(async (signal) => {
    const ai = getClientForTask(model, 'text');
    /**
     * 单轮仅 user：用显式 `[{ role:'user', parts }]`，避免仅 `{ parts }` 时部分网关误解析并报
     * “valid stable user model” 等；多轮对话仍用完整 role 数组。
     */
    const single = contents.length === 1 ? contents[0] : null;
    const useSingleUserTurn =
      single != null &&
      single.role === 'user' &&
      Array.isArray(single.parts) &&
      single.parts.length > 0;
    const payload: unknown = useSingleUserTurn
      ? [{ role: 'user' as const, parts: single!.parts }]
      : contents.map((c) => ({
          role: c.role === 'model' ? 'model' : 'user',
          parts: c.parts,
        }));
    const genConfig: Record<string, unknown> = {};
    if (options?.responseMimeType) {
      genConfig.responseMimeType = options.responseMimeType;
    }
    const response = await ai.models.generateContent({
      model: resolvedModel,
      contents: payload,
      config: buildGeminiConfig(genConfig, signal, options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS, model)
    });
    const text = response.text?.trim();
    if (text == null) throw new Error('Empty text response');
    return text;
  }, options);
}

const SITE_ASSISTANT_SYSTEM = `You are the in-app assistant for AssetCutter AI Pro, a web app for intelligent asset production. You help users with:
- How to use features: 工作流 (compose / generate), 贴图修缝 / 生成贴图, 生成3D, 能力预设, 提示词擂台, 设置.
- Troubleshooting: e.g. "贴图修缝" needs Python backend or Pyodide; 生成贴图 / 工作流生图 need Gemini API Key saved in Settings.
- Other questions about the product. Reply in the same language as the user. Be concise and helpful.`;

/** 网站助手：根据用户提问 + 可选历史对话，返回助手回复（带系统角色） */
export async function getSiteAssistantResponse(
  userMessage: string,
  history: Array<{ role: 'user' | 'model'; text: string }> = [],
  model = DEFAULT_MODEL_TEXT,
  options?: GeminiRequestOptions
): Promise<string> {
  const resolvedModel = resolveUpstreamTextModelId(model);
  return callWithRetry(async (signal) => {
    const ai = getAI();
    const contents = [
      ...history.map((m) => ({ role: m.role as 'user' | 'model', parts: [{ text: m.text }] as { text: string }[] })),
      { role: 'user' as const, parts: [{ text: (userMessage || '').trim() || '(empty)' }] }
    ];
    const response = await ai.models.generateContent({
      model: resolvedModel,
      contents,
      config: buildGeminiConfig({ systemInstruction: SITE_ASSISTANT_SYSTEM }, signal, options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS, model)
    });
    const text = response.text?.trim();
    if (text == null) throw new Error('助手未返回内容');
    return text;
  }, options);
}

/** 网站助手流式：每收到一段文本就调用 onChunk(当前完整文本)，返回最终完整文本 */
export async function getSiteAssistantResponseStream(
  userMessage: string,
  history: Array<{ role: 'user' | 'model'; text: string }>,
  onChunk: (fullText: string) => void,
  model = DEFAULT_MODEL_TEXT,
  options?: GeminiRequestOptions
): Promise<string> {
  /** 走后端代理时没有 generateContentStream，统一走非流式（与 !apiKey && AI Worker Proxy 时行为一致） */
  if (effectiveAiWorkerProxyBase()) {
    const full = await getSiteAssistantResponse(userMessage, history, model, options);
    onChunk(full);
    return full;
  }
  const resolvedModel = resolveUpstreamTextModelId(model);
  return callWithRetry(async (signal) => {
    const ai = getAI();
    const contents = [
      ...history.map((m) => ({ role: m.role as 'user' | 'model', parts: [{ text: m.text }] as { text: string }[] })),
      { role: 'user' as const, parts: [{ text: (userMessage || '').trim() || '(empty)' }] }
    ];
    const stream = await ai.models.generateContentStream({
      model: resolvedModel,
      contents,
      config: buildGeminiConfig({ systemInstruction: SITE_ASSISTANT_SYSTEM }, signal, options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS, model)
    });
    let full = '';
    for await (const chunk of stream) {
      if (signal.aborted) throw createAbortError('请求已取消');
      const t = chunk.text;
      if (t != null && typeof t === 'string') full += t;
      onChunk(full);
    }
    return full.trim();
  }, options);
}

function resolveArenaWriterSystemPrompt(options?: GeminiRequestOptions): string {
  const fromOpt =
    options?.arenaPromptWriter?.trim() ||
    options?.arenaPromptAb?.trim() ||
    options?.arenaPromptAbN?.trim();
  const base = (fromOpt || DEFAULT_PROMPTS.arena_writer).trim();
  return base || DEFAULT_PROMPTS.arena_writer;
}

/** 擂台 V2：根据自然语言描述生成两条生图用英文提示词 A/B，并返回推理过程。见 docs/PROMPT_OPTIMIZATION_AB_DESIGN.md §9 */
export async function generateArenaABPrompts(
  userDescription: string,
  model = DEFAULT_MODEL_TEXT,
  options?: GeminiRequestOptions
): Promise<{ reasoning?: string; promptA: string; promptB: string; rawResponse?: string }> {
  const resolvedModel = resolveUpstreamTextModelId(model);
  const sysAb = resolveArenaWriterSystemPrompt(options);
  const raw = await callWithRetry(async (signal) => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: resolvedModel,
      contents: [
        {
          role: 'user' as const,
          parts: [
            { text: sysAb },
            {
              text: `User description: ${(userDescription || '').trim().slice(0, 500)}\n\nN = 2. Output exactly 2 prompts (promptA, promptB). Important: These prompts will be sent to the image model together with the user's uploaded image. Ensure each prompt is an instruction to modify or transform that image (not a standalone description of a new scene).`,
            },
          ],
        },
      ],
      config: buildGeminiConfig({ responseMimeType: 'application/json' }, signal, options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS, model)
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Empty arena A/B response');
    return text;
  }, options);
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning.trim() : undefined;
    const promptA = typeof obj.promptA === 'string' ? obj.promptA.trim() : '';
    const promptB = typeof obj.promptB === 'string' ? obj.promptB.trim() : '';
    if (!promptA || !promptB) throw new Error('Missing promptA or promptB');
    return { reasoning, promptA, promptB, rawResponse: raw };
  } catch (e) {
    const fallback = (raw || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (fallback.length >= 2) return { promptA: fallback[0], promptB: fallback[1], rawResponse: raw };
    throw new Error('Failed to parse arena A/B prompts: ' + String(e));
  }
}

/** 擂台 V2：根据胜者提示词优化败者提示词，返回推理过程与新英文生图提示词。可选传入用户反馈的败者差距与胜者优点。见 docs/PROMPT_OPTIMIZATION_AB_DESIGN.md §9 */
export async function optimizeLoserPrompt(
  winnerPrompt: string,
  loserPrompt: string,
  userDescription?: string,
  model = DEFAULT_MODEL_TEXT,
  allPreviousPrompts?: string[],
  userReportedGaps?: string[],
  winnerStrength?: string,
  loserRemark?: string,
  options?: GeminiRequestOptions
): Promise<{ reasoning?: string; prompt: string; rawResponse?: string }> {
  const raw = await callWithRetry(async (signal) => {
    const ai = getAI();
    const userText = [
      `Winner prompt (user preferred): ${winnerPrompt}`,
      `Loser prompt (to improve): ${loserPrompt}`,
      userDescription ? `Original user intent: ${userDescription}` : '',
      allPreviousPrompts && allPreviousPrompts.length > 0
        ? `Other prompts already in this arena (avoid repeating, use for context):\n${allPreviousPrompts.map((p, i) => `[${i + 1}] ${p}`).join('\n')}`
        : '',
      userReportedGaps && userReportedGaps.length > 0
        ? `User-reported gaps in the loser (address or avoid these when improving): ${userReportedGaps.join(', ')}`
        : '',
      winnerStrength && winnerStrength.trim()
        ? `User-reported strength of the winner (preserve or learn from): ${winnerStrength.trim()}`
        : '',
      loserRemark && loserRemark.trim()
        ? `User-reported remark about the loser (one sentence, address when improving): ${loserRemark.trim()}`
        : ''
    ].filter(Boolean).join('\n\n');
    const sysOpt =
      (options?.arenaPromptOptimizeLoser ?? DEFAULT_PROMPTS.arena_optimize_loser).trim() ||
      DEFAULT_PROMPTS.arena_optimize_loser;
    const resolvedModel = resolveUpstreamTextModelId(model);
    const response = await ai.models.generateContent({
      model: resolvedModel,
      contents: [
        {
          role: 'user' as const,
          parts: [{ text: sysOpt }, { text: userText }],
        },
      ],
      config: buildGeminiConfig({ responseMimeType: 'application/json' }, signal, options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS, model)
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Empty optimize loser response');
    return text;
  }, options);
  try {
    const cleaned = (raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning.trim() : undefined;
    const prompt = (typeof obj.prompt === 'string' ? obj.prompt : raw).replace(/^["']|["']$/g, '').trim().slice(0, 2000);
    if (!prompt) throw new Error('Missing prompt in response');
    return { reasoning, prompt, rawResponse: raw };
  } catch {
    const fallback = (raw || '').replace(/^["']|["']$/g, '').trim().slice(0, 2000);
    return { prompt: fallback, rawResponse: raw };
  }
}

/** 擂台：根据自然语言描述生成 N 条（2/3/4）提示词及推理过程。count=2 时复用 generateArenaABPrompts。 */
export async function generateArenaPrompts(
  userDescription: string,
  count: 2 | 3 | 4,
  model = DEFAULT_MODEL_TEXT,
  options?: GeminiRequestOptions
): Promise<{ reasoning?: string; prompts: string[]; rawResponse?: string }> {
  if (count === 2) {
    const out = await generateArenaABPrompts(userDescription, model, options);
    return { reasoning: out.reasoning, prompts: [out.promptA, out.promptB], rawResponse: out.rawResponse };
  }
  const sysWriter = resolveArenaWriterSystemPrompt(options);
  const resolvedModel = resolveUpstreamTextModelId(model);
  const raw = await callWithRetry(async (signal) => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: resolvedModel,
      contents: [
        {
          role: 'user' as const,
          parts: [
            { text: sysWriter },
            {
              text: `User description: ${(userDescription || '').trim().slice(0, 500)}\n\nN = ${count}. Output exactly ${count} prompts (promptA, promptB${count >= 3 ? ', promptC' : ''}${count >= 4 ? ', promptD' : ''}). Important: These prompts will be sent to the image model together with the user's uploaded image; ensure each prompt is an instruction to modify or transform that image (not a standalone description of a new scene).`,
            },
          ],
        },
      ],
      config: buildGeminiConfig({ responseMimeType: 'application/json' }, signal, options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS, model)
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Empty arena N response');
    return text;
  }, options);
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning.trim() : undefined;
    const prompts: string[] = [
      obj.promptA,
      obj.promptB,
      count >= 3 && obj.promptC ? obj.promptC : null,
      count >= 4 && obj.promptD ? obj.promptD : null
    ].filter(Boolean).map((p: string) => (typeof p === 'string' ? p : '').trim());
    if (prompts.length !== count) throw new Error(`Expected ${count} prompts, got ${prompts.length}`);
    return { reasoning, prompts, rawResponse: raw };
  } catch (e) {
    const fallback = (raw || '').split(/\n+/).map((s: string) => s.trim()).filter(Boolean).slice(0, count);
    if (fallback.length >= count) return { prompts: fallback, rawResponse: raw };
    throw new Error('Failed to parse arena N prompts: ' + String(e));
  }
}

/** 擂台：根据全量信息生成一名新挑战者提示词及推理过程。 */
export async function generateNewChallenger(
  userIntent: string,
  championPrompt: string,
  allPreviousPrompts: string[],
  model = DEFAULT_MODEL_TEXT,
  options?: GeminiRequestOptions
): Promise<{ reasoning?: string; prompt: string; rawResponse?: string }> {
  const raw = await callWithRetry(async (signal) => {
    const ai = getAI();
    const userText = [
      `Original user intent: ${userIntent}`,
      `Current champion (winner) prompt: ${championPrompt}`,
      allPreviousPrompts.length > 0
        ? `All other prompts already in this arena (be distinct from these):\n${allPreviousPrompts.map((p, i) => `[${i + 1}] ${p}`).join('\n')}`
        : ''
    ].filter(Boolean).join('\n\n');
    const sysNc =
      (options?.arenaPromptNewChallenger ?? DEFAULT_PROMPTS.arena_new_challenger).trim() ||
      DEFAULT_PROMPTS.arena_new_challenger;
    const resolvedModel = resolveUpstreamTextModelId(model);
    const response = await ai.models.generateContent({
      model: resolvedModel,
      contents: [
        {
          role: 'user' as const,
          parts: [{ text: sysNc }, { text: userText }],
        },
      ],
      config: buildGeminiConfig({ responseMimeType: 'application/json' }, signal, options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS, model)
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Empty new challenger response');
    return text;
  }, options);
  try {
    const cleaned = (raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning.trim() : undefined;
    const prompt = (typeof obj.prompt === 'string' ? obj.prompt : raw).replace(/^["']|["']$/g, '').trim().slice(0, 2000);
    if (!prompt) throw new Error('Missing prompt in response');
    return { reasoning, prompt, rawResponse: raw };
  } catch {
    const fallback = (raw || '').replace(/^["']|["']$/g, '').trim().slice(0, 2000);
    return { prompt: fallback, rawResponse: raw };
  }
}

export async function translateToChinese(
  text: string,
  model = DEFAULT_MODEL_TEXT,
  options?: GeminiRequestOptions
): Promise<string> {
  const source = (text || '').trim();
  if (!source) return '';
  const resolvedModel = resolveUpstreamTextModelId(model);
  return callWithRetry(async (signal) => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: resolvedModel,
      contents: [
        {
          role: 'user' as const,
          parts: [
            {
              text:
                'Translate the following text into concise Simplified Chinese. Keep structure, bullet points, and code-like fragments when possible. Output ONLY the translated text.',
            },
            { text: source.slice(0, 12000) },
          ],
        },
      ],
      config: buildGeminiConfig({}, signal, options?.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS, model)
    });
    const out = response.text?.trim();
    if (!out) throw new Error('Empty translation response');
    return out;
  }, options);
}

/** 生成贴图模块：根据功能贴图 + 描述生成 PBR 贴图（Base Color / Roughness / Metallic） */
export interface PbrTextureMapInput {
  type: string;
  base64: string | null;
}
export async function generatePBRTexture(
  functionalMaps: PbrTextureMapInput[],
  prompt: string,
  targetType: 'BASE_COLOR' | 'ROUGHNESS' | 'METALLIC',
  baseColorMap?: { base64: string },
  options?: GeminiRequestOptions
): Promise<string> {
  return callWithRetry(async (signal) => {
    const modelId = DEFAULT_MODEL_IMAGE;
    const ai = getAIForImageModel(modelId);
    const imageModel = resolveUpstreamImageModelIdForRegistry(modelId);
    const parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] = [];

    functionalMaps.forEach((map) => {
      if (map.base64) {
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: map.base64.split(',')[1] ?? map.base64
          }
        });
        parts.push({ text: `This is the ${map.type} map context.` });
      }
    });

    if (baseColorMap?.base64) {
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: baseColorMap.base64.split(',')[1] ?? baseColorMap.base64
        }
      });
      parts.push({ text: `This is the generated Base Color map to use as reference for ${targetType}.` });
    }

    const systemInstruction =
      targetType === 'BASE_COLOR'
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

    parts.push({ text: systemInstruction });

    const timeoutMs = options?.timeoutMs ?? GEMINI_IMAGE_REQUEST_TIMEOUT_MS;
    const response = await ai.models.generateContent({
      model: imageModel,
      contents: [{ role: 'user' as const, parts }],
      config: buildGeminiConfig({
        imageConfig: { aspectRatio: '1:1' }
      }, signal, timeoutMs, modelId)
    });

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    throw new Error('No image data returned from AI');
  }, { ...options, timeoutMs: options?.timeoutMs ?? GEMINI_IMAGE_REQUEST_TIMEOUT_MS, retries: 0 });
}
