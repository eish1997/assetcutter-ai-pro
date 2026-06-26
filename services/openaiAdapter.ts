/**
 * OpenAI 官方 HTTP API 适配：Chat Completions + GPT Image（Image API）。
 * 对齐站内 `GeminiClientLike`（`generateContent` / `generateContentStream`）。
 *
 * 生图仅支持 GPT Image 系列（`gpt-image-1.5` / `gpt-image-2` 等），走官方 Image API：
 * - POST /v1/images/generations（文生图）
 * - POST /v1/images/edits（JSON `images[]`，最多 16 张参考图）
 *
 * @see https://platform.openai.com/docs/api-reference/chat
 * @see https://platform.openai.com/docs/api-reference/images
 * @see https://platform.openai.com/docs/guides/image-generation
 */

import type { GeminiClientLike } from "./toapisAdapter";
import {
  geminiContentsToOpenAiMessages,
  isImageGenerationModel,
  parseOpenAiChatCompletionsBody,
  parseToapisHttpErrorJson,
} from "./toapisAdapter";
import { coerceImageModelRegistryId } from "./modelRegistry/imageModels";
import { SUPPORTED_IMAGE_SIZES } from "../types";
import { WORKFLOW_IMAGE_GEN_PROMPT_OFFICIAL_MAX_CHARS } from "./workflowTextLimits";
import { emitOpenAiMeteredUsage } from "./observability/metering/emitOpenAi";
import {
  OPENAI_STREAM_USAGE_KEY,
  resolveMeteringRegistryId,
} from "./observability/metering/emitGeminiChannel";
import {
  meterReadingFromOpenAiChat,
  meterReadingFromOpenAiImage,
  newOpenAiRequestId,
} from "./observability/metering/adapters/openai";

export function normalizeOpenAiBaseUrl(raw: string): string {
  const s = (raw || "").trim().replace(/\/+$/, "");
  if (!s) return "https://api.openai.com/v1";
  if (/\/v1$/i.test(s)) return s;
  return `${s.replace(/\/$/, "")}/v1`;
}

/** 是否为 OpenAI 官方 API 根（空配置默认也算） */
export function isOpenAiOfficialBaseUrl(raw: string): boolean {
  try {
    const normalized = normalizeOpenAiBaseUrl(raw);
    return new URL(normalized).hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
}

/**
 * 解析实际请求的 OpenAI Base URL（须含 /v1）。
 * - 浏览器直连 api.openai.com 会触发 CORS，表现为 Failed to fetch。
 * - 开发环境（Vite）对官方地址默认走同源 `/__openai/v1`，由 vite.config 反代到 api.openai.com。
 * - 可选 `VITE_OPENAI_PROXY`：显式指定代理根（生产可配 Nginx 同源路径）。
 * - 可选 `VITE_OPENAI_DIRECT=true`：开发时仍直连设置页地址（验证中转是否已放行 CORS）。
 * - 非官方 host（如 ToAPIs）不做 __openai 改写。
 */
export function resolveOpenAiBaseUrl(userStored: string): string {
  const env =
    typeof import.meta !== "undefined"
      ? (import.meta as { env?: Record<string, string | boolean> }).env
      : undefined;
  const proxyFromEnv = String(env?.VITE_OPENAI_PROXY || "").trim();
  if (proxyFromEnv) {
    if (proxyFromEnv.startsWith("/")) {
      if (typeof window !== "undefined" && window.location?.origin) {
        return `${window.location.origin.replace(/\/+$/, "")}${proxyFromEnv}`.replace(/\/+$/, "");
      }
      return proxyFromEnv.replace(/\/+$/, "");
    }
    return normalizeOpenAiBaseUrl(proxyFromEnv);
  }
  const direct = env?.VITE_OPENAI_DIRECT === "true" || env?.VITE_OPENAI_DIRECT === true;
  const normalized = normalizeOpenAiBaseUrl(userStored);
  if (
    env?.DEV &&
    !direct &&
    isOpenAiOfficialBaseUrl(userStored) &&
    typeof window !== "undefined" &&
    window.location?.origin
  ) {
    return `${window.location.origin.replace(/\/+$/, "")}/__openai/v1`;
  }
  return normalized;
}

/** 站内或上游 id → OpenAI Chat 模型（已是 `gpt-*` / `o*` 则原样） */
export function mapOpenAiChatModel(model: string): string {
  const m = (model || "").trim();
  const ml = m.toLowerCase();
  if (!m) return "gpt-4o-mini";
  if (ml.startsWith("gpt-") || ml.startsWith("o1") || ml.startsWith("o3") || ml.startsWith("o4")) return m;
  if (ml.includes("pro-preview") || ml.includes("3-pro")) return "gpt-4o";
  if (ml.includes("flash")) return "gpt-4o-mini";
  return "gpt-4o-mini";
}

/** 站内或上游 id → OpenAI GPT Image 模型 id */
export function mapOpenAiImageModel(model: string): string {
  const m = (model || "").trim();
  const ml = m.toLowerCase();
  if (!m) return "gpt-image-1.5";
  if (ml === "gpt-image-1" || ml.startsWith("dall-e")) return "gpt-image-1.5";
  if (ml.includes("gpt-image")) return m;
  return "gpt-image-1.5";
}

export function isGptImage2Model(model: string): boolean {
  const ml = mapOpenAiImageModel(model).toLowerCase();
  return ml === "gpt-image-2" || ml.startsWith("gpt-image-2-");
}

type GeminiPart = { text?: string; inlineData?: { mimeType?: string; data?: string } };
type GeminiTurn = { role: "user" | "model"; parts: GeminiPart[] };

function parseContents(contents: unknown): GeminiTurn[] {
  if (Array.isArray(contents)) {
    return contents as GeminiTurn[];
  }
  if (contents && typeof contents === "object" && Array.isArray((contents as { parts?: unknown }).parts)) {
    return [{ role: "user", parts: (contents as { parts: GeminiPart[] }).parts }];
  }
  return [{ role: "user", parts: [{ text: String(contents ?? "") }] }];
}

/** GPT Image 官方 prompt 上限 32000 字符 */
const GPT_IMAGE_PROMPT_MAX_CHARS = WORKFLOW_IMAGE_GEN_PROMPT_OFFICIAL_MAX_CHARS;
const GPT_IMAGE_MAX_REFERENCE_IMAGES = 16;

function clampOpenAiImagePrompt(systemInstruction: string, userText: string, max: number): string {
  const sys = systemInstruction.trim();
  const usr = userText.trim();
  const combined = [sys, usr].filter(Boolean).join("\n\n").trim();
  if (!combined) return "";
  if (combined.length <= max) return combined;
  if (!usr) return sys.slice(0, max);
  if (usr.length >= max) return usr.slice(0, max);
  const sep = sys ? "\n\n" : "";
  const budget = max - usr.length - sep.length;
  if (budget <= 0) return usr;
  return sys ? `${sys.slice(0, budget)}${sep}${usr}` : usr;
}

/** gpt-image-1.5 等：官方仅支持三种固定 `size`（见 Image API 文档） */
export function aspectRatioToGptImage15Size(aspect?: string): string {
  const a = (aspect || "1:1").trim().toLowerCase();
  if (a === "1:1") return "1024x1024";
  const wide = new Set(["16:9", "21:9", "4:3", "3:2", "5:4"]);
  const tall = new Set(["9:16", "3:4", "2:3", "4:5"]);
  if (wide.has(a)) return "1536x1024";
  if (tall.has(a)) return "1024x1536";
  return "1024x1024";
}

/** OpenAI gpt-image-2：`size` 最长边硬上限 */
export const GPT_IMAGE2_MAX_LONG_EDGE = 3840;

/** OpenAI gpt-image-2：总像素下限 / 上限 */
export const GPT_IMAGE2_MIN_TOTAL_PIXELS = 655_360;
export const GPT_IMAGE2_MAX_TOTAL_PIXELS = 8_294_400;

/** 未选 1K/2K/4K 时 gpt-image-2 默认长边 */
export const GPT_IMAGE2_DEFAULT_LONG_EDGE = 1536;

/** 1K/2K/4K 目标像素预算（对齐 Gemini 档位 + OpenAI 2K/4K 参考） */
export function gptImage2TargetPixelsFromImageSize(imageSize?: string): number | null {
  const s = (imageSize || "").trim().toUpperCase();
  if (s === "1K") return 1_048_576;
  if (s === "2K") return 3_686_400;
  if (s === "4K") return GPT_IMAGE2_MAX_TOTAL_PIXELS;
  return null;
}

/** 兼容旧引用：档位对应的大致长边上限（实际尺寸以像素预算求解为准） */
export function gptImage2LongEdgeFromImageSize(imageSize?: string): number {
  const s = (imageSize || "").trim().toUpperCase();
  if (s === "1K") return 1024;
  if (s === "2K") return 2048;
  if (s === "4K") return GPT_IMAGE2_MAX_LONG_EDGE;
  return GPT_IMAGE2_DEFAULT_LONG_EDGE;
}

function parseAspectRatioParts(aspect?: string): { rw: number; rh: number } {
  const a = (aspect || "1:1").trim().toLowerCase();
  const parts = a.split(":");
  if (parts.length !== 2) return { rw: 1, rh: 1 };
  const rw = Number(parts[0]);
  const rh = Number(parts[1]);
  if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) return { rw: 1, rh: 1 };
  return { rw, rh };
}

function roundGptImage2Dimension(value: number): number {
  return Math.max(16, Math.round(value / 16) * 16);
}

function dimensionsFromAspectAndPixelTarget(rw: number, rh: number, targetPixels: number): { width: number; height: number } {
  const safeTarget = Math.max(GPT_IMAGE2_MIN_TOTAL_PIXELS, Math.min(GPT_IMAGE2_MAX_TOTAL_PIXELS, targetPixels));
  const width = Math.sqrt((safeTarget * rw) / rh);
  const height = Math.sqrt((safeTarget * rh) / rw);
  return { width, height };
}

function clampGptImage2MaxLongEdge(width: number, height: number): { width: number; height: number } {
  let w = width;
  let h = height;
  const maxDim = Math.max(w, h);
  if (maxDim > GPT_IMAGE2_MAX_LONG_EDGE) {
    const scale = GPT_IMAGE2_MAX_LONG_EDGE / maxDim;
    w *= scale;
    h *= scale;
  }
  return { width: w, height: h };
}

function enforceGptImage2PixelBounds(width: number, height: number): { width: number; height: number } {
  let w = roundGptImage2Dimension(width);
  let h = roundGptImage2Dimension(height);
  let pixels = w * h;

  if (pixels < GPT_IMAGE2_MIN_TOTAL_PIXELS) {
    const scale = Math.sqrt(GPT_IMAGE2_MIN_TOTAL_PIXELS / Math.max(1, pixels));
    w = roundGptImage2Dimension(w * scale);
    h = roundGptImage2Dimension(h * scale);
    pixels = w * h;
    for (let i = 0; i < 48 && pixels < GPT_IMAGE2_MIN_TOTAL_PIXELS; i += 1) {
      if (w <= h && w + 16 <= GPT_IMAGE2_MAX_LONG_EDGE) w += 16;
      else if (h + 16 <= GPT_IMAGE2_MAX_LONG_EDGE) h += 16;
      else if (w + 16 <= GPT_IMAGE2_MAX_LONG_EDGE) w += 16;
      else break;
      pixels = w * h;
    }
  }

  pixels = w * h;
  if (pixels > GPT_IMAGE2_MAX_TOTAL_PIXELS) {
    const scale = Math.sqrt(GPT_IMAGE2_MAX_TOTAL_PIXELS / pixels);
    w = roundGptImage2Dimension(w * scale);
    h = roundGptImage2Dimension(h * scale);
    pixels = w * h;
    for (let i = 0; i < 48 && pixels > GPT_IMAGE2_MAX_TOTAL_PIXELS; i += 1) {
      if (w >= h && w > 16) w -= 16;
      else if (h > 16) h -= 16;
      else break;
      pixels = w * h;
    }
  }

  return { width: w, height: h };
}

function finalizeGptImage2Dimensions(width: number, height: number): { width: number; height: number } {
  let w = width;
  let h = height;
  for (let i = 0; i < 4; i += 1) {
    const edgeClamped = clampGptImage2MaxLongEdge(w, h);
    const bounded = enforceGptImage2PixelBounds(edgeClamped.width, edgeClamped.height);
    if (bounded.width === w && bounded.height === h) {
      return bounded;
    }
    w = bounded.width;
    h = bounded.height;
  }
  return enforceGptImage2PixelBounds(w, h);
}

export function parseGptImage2SizeString(size: string): { width: number; height: number } {
  const [wRaw, hRaw] = size.split("x");
  return { width: Number(wRaw), height: Number(hRaw) };
}

/** 校验 gpt-image-2 官方 size 约束 */
export function isValidGptImage2Size(size: string): boolean {
  const { width, height } = parseGptImage2SizeString(size);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16) return false;
  if (width % 16 !== 0 || height % 16 !== 0) return false;
  if (Math.max(width, height) > GPT_IMAGE2_MAX_LONG_EDGE) return false;
  const pixels = width * height;
  if (pixels < GPT_IMAGE2_MIN_TOTAL_PIXELS || pixels > GPT_IMAGE2_MAX_TOTAL_PIXELS) return false;
  const ratio = width / height;
  return ratio <= 3 && ratio >= 1 / 3;
}

/**
 * gpt-image-2：按长边与比例计算 WIDTHxHEIGHT，并自动钳制到 OpenAI 合法区间。
 */
export function aspectRatioToGptImage2Pixels(aspect?: string, longEdge = GPT_IMAGE2_DEFAULT_LONG_EDGE): string {
  const { rw, rh } = parseAspectRatioParts(aspect);
  const edge = Math.min(GPT_IMAGE2_MAX_LONG_EDGE, Math.max(16, Math.floor(longEdge)));
  const width = rw >= rh ? edge : (edge * rw) / rh;
  const height = rw >= rh ? (edge * rh) / rw : edge;
  const finalized = finalizeGptImage2Dimensions(width, height);
  return `${finalized.width}x${finalized.height}`;
}

/** gpt-image-2：按 aspectRatio + 1K/2K/4K（像素预算）或默认长边生成合法 size */
export function aspectRatioToGptImage2Size(aspect?: string, imageSize?: string): string {
  const { rw, rh } = parseAspectRatioParts(aspect);
  const targetPixels = gptImage2TargetPixelsFromImageSize(imageSize);
  const { width, height } =
    targetPixels != null
      ? dimensionsFromAspectAndPixelTarget(rw, rh, targetPixels)
      : {
          width: rw >= rh ? GPT_IMAGE2_DEFAULT_LONG_EDGE : (GPT_IMAGE2_DEFAULT_LONG_EDGE * rw) / rh,
          height: rw >= rh ? (GPT_IMAGE2_DEFAULT_LONG_EDGE * rh) / rw : GPT_IMAGE2_DEFAULT_LONG_EDGE,
        };
  const finalized = finalizeGptImage2Dimensions(width, height);
  return `${finalized.width}x${finalized.height}`;
}

export function resolveGptImageSize(model: string, aspectRatio?: string, imageSize?: string): string {
  return isGptImage2Model(model)
    ? aspectRatioToGptImage2Size(aspectRatio, imageSize)
    : aspectRatioToGptImage15Size(aspectRatio);
}

/** gpt-image-1.5 仅 1536 边，UI 不应提供 2K/4K */
export function imageSizeSelectOptionsForRegistryModel(
  registryId?: string
): Array<{ readonly value: string; readonly label: string }> {
  const id = coerceImageModelRegistryId(registryId || "");
  if (id === "gpt-image-1.5") {
    return SUPPORTED_IMAGE_SIZES.filter((s) => s.value === "1K");
  }
  return SUPPORTED_IMAGE_SIZES;
}

export function imageSizeDropdownOptionsForRegistryModel(registryId?: string): Array<{ value: string; label: string }> {
  return [
    { value: "", label: "默认" },
    ...imageSizeSelectOptionsForRegistryModel(registryId).map((s) => ({ value: s.value, label: s.label })),
  ];
}

export function coerceImageSizeForOpenAiImageModel(registryId: string, imageSize?: string): string | undefined {
  const raw = (imageSize || "").trim();
  if (!raw) return undefined;
  const tier = raw.toUpperCase();
  if (coerceImageModelRegistryId(registryId) === "gpt-image-1.5" && tier !== "1K") {
    return undefined;
  }
  if (isGptImage2Model(registryId) && tier !== "1K" && tier !== "2K" && tier !== "4K") {
    return undefined;
  }
  return raw;
}

/** 站内 Gemini 风格 imageSize（1K/2K/4K）→ OpenAI quality */
export function gptImageQualityFromImageSize(imageSize?: string): "low" | "medium" | "high" | "auto" {
  const s = (imageSize || "").trim().toUpperCase();
  if (s === "4K" || s === "2K") return "high";
  if (s === "1K") return "medium";
  return "auto";
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(binary);
}

async function fetchAsDataUrl(imageUrl: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(imageUrl, { signal, mode: "cors" });
  if (!res.ok) throw new Error(`拉取生成图失败（${res.status}）`);
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);
  const mime = blob.type || "image/png";
  return `data:${mime};base64,${b64}`;
}

async function readResponseBody(res: Response): Promise<{ json: unknown | null; text: string }> {
  const text = await res.text();
  const t = text.trim();
  if (!t) return { json: null, text: "" };
  try {
    return { json: JSON.parse(t) as unknown, text: t };
  } catch {
    return { json: null, text: t };
  }
}

function formatOpenAiImageError(parsed: unknown, status: number, fallback: string, raw: string): string {
  const base = parseToapisHttpErrorJson(parsed, status, fallback, raw);
  const msg = base.toLowerCase();
  if (msg.includes("organization") && (msg.includes("verif") || msg.includes("verify"))) {
    return `${base}（GPT Image 模型可能需在 OpenAI 控制台完成组织验证）`;
  }
  return base;
}

async function officialOpenAiImageJsonToGeminiShape(
  json: unknown,
  signal?: AbortSignal
): Promise<{ text?: string; candidates: unknown[] }> {
  const cj = json as {
    data?: Array<{ url?: string; b64_json?: string }>;
    error?: { message?: string };
  };
  const errMsg = cj?.error && typeof cj.error === "object" ? (cj.error as { message?: string }).message : undefined;
  if (typeof errMsg === "string" && errMsg.trim()) {
    throw new Error(errMsg.trim());
  }
  const sync0 = Array.isArray(cj.data) ? cj.data[0] : undefined;
  if (sync0?.b64_json && String(sync0.b64_json).trim()) {
    return {
      candidates: [
        {
          content: {
            parts: [{ inlineData: { mimeType: "image/png", data: String(sync0.b64_json).trim() } }],
          },
        },
      ],
    };
  }
  if (sync0?.url && String(sync0.url).trim()) {
    const dataUrl = await fetchAsDataUrl(String(sync0.url).trim(), signal);
    const base64Part = dataUrl.split(",")[1] || "";
    return {
      candidates: [
        {
          content: {
            parts: [{ inlineData: { mimeType: "image/png", data: base64Part } }],
          },
        },
      ],
    };
  }
  throw new Error("图像响应中无 data[0].b64_json 或 url");
}

function buildGeminiLikeTextResponse(text: string): { text: string; candidates: { content: { parts: { text: string }[] } }[] } {
  return {
    text,
    candidates: [{ content: { parts: [{ text }] } }],
  };
}

async function openAiChatGenerateContent(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  signal?: AbortSignal;
  meteringProvider?: string;
}): Promise<{ text?: string; candidates?: unknown[] }> {
  const cfg = args.config || {};
  const systemInstruction = typeof cfg.systemInstruction === "string" ? cfg.systemInstruction : undefined;
  const responseMimeType = cfg.responseMimeType as string | undefined;
  const messages = geminiContentsToOpenAiMessages(args.contents, systemInstruction);
  const mappedModel = mapOpenAiChatModel(args.model);
  const body: Record<string, unknown> = {
    model: mappedModel,
    messages,
    stream: false,
  };
  if (responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch(`${args.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: (cfg.abortSignal as AbortSignal | undefined) ?? args.signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    let parsed: unknown;
    try {
      parsed = raw.trim() ? (JSON.parse(raw) as unknown) : null;
    } catch {
      parsed = null;
    }
    throw new Error(parseToapisHttpErrorJson(parsed, res.status, raw || `Chat 请求失败（${res.status}）`, raw));
  }
  const parsed = parseOpenAiChatCompletionsBody(raw);
  const content = parsed.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : content != null ? String(content) : "";
  let parsedFull: unknown = null;
  try {
    parsedFull = JSON.parse(raw);
  } catch {
    parsedFull = null;
  }
  const requestId = newOpenAiRequestId();
  const provider = args.meteringProvider || "openai-official";
  const registryId = resolveMeteringRegistryId({ model: args.model, config: cfg });
  emitOpenAiMeteredUsage({
    registryId,
    reading: meterReadingFromOpenAiChat({
      registryId,
      provider,
      raw: parsedFull,
    }),
    requestId,
    jobKind: "workflow_chat",
  });
  return buildGeminiLikeTextResponse(text);
}

function buildGptImageRequestBody(args: {
  model: string;
  prompt: string;
  imageConfig: { aspectRatio?: string; imageSize?: string };
  inlineImages: string[];
}): Record<string, unknown> {
  const mappedModel = mapOpenAiImageModel(args.model);
  const effectiveImageSize = coerceImageSizeForOpenAiImageModel(mappedModel, args.imageConfig.imageSize);
  const size = resolveGptImageSize(mappedModel, args.imageConfig.aspectRatio, effectiveImageSize);
  const quality = gptImageQualityFromImageSize(effectiveImageSize);
  const body: Record<string, unknown> = {
    model: mappedModel,
    prompt: args.prompt,
    n: 1,
    size,
    quality,
    output_format: "png",
  };
  if (args.inlineImages.length > 0) {
    body.images = args.inlineImages.slice(0, GPT_IMAGE_MAX_REFERENCE_IMAGES).map((dataUrl) => ({
      image_url: dataUrl,
    }));
  }
  return body;
}

/**
 * 官方 GPT Image：generations（文生图）或 edits JSON（多参考图，最多 16 张）。
 */
async function openAiImageGenerateContent(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  signal?: AbortSignal;
  meteringProvider?: string;
}): Promise<{ text?: string; candidates?: unknown[] }> {
  const cfg = args.config || {};
  const systemInstruction = typeof cfg.systemInstruction === "string" ? cfg.systemInstruction : "";
  const imageConfig = (cfg.imageConfig || {}) as { aspectRatio?: string; imageSize?: string };

  const turns = parseContents(args.contents);
  const userParts = turns.find((t) => t.role === "user")?.parts || turns[0]?.parts || [];
  const textPieces: string[] = [];
  const inlineImages: string[] = [];
  for (const p of userParts) {
    if (p.text) textPieces.push(p.text);
    if (p.inlineData?.data) {
      const mime = p.inlineData.mimeType || "image/jpeg";
      inlineImages.push(`data:${mime};base64,${p.inlineData.data}`);
    }
  }
  const userText = textPieces.join("\n").trim();
  const prompt = clampOpenAiImagePrompt(systemInstruction, userText, GPT_IMAGE_PROMPT_MAX_CHARS);
  if (!prompt) throw new Error("生图提示词为空");

  const signal = (cfg.abortSignal as AbortSignal | undefined) ?? args.signal;
  const body = buildGptImageRequestBody({
    model: args.model,
    prompt,
    imageConfig,
    inlineImages,
  });
  const endpoint = inlineImages.length > 0 ? "edits" : "generations";

  const res = await fetch(`${args.baseUrl}/images/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  const { json, text: bodyText } = await readResponseBody(res);
  if (!res.ok) {
    throw new Error(
      formatOpenAiImageError(
        json,
        res.status,
        endpoint === "edits" ? `图像编辑失败（${res.status}）` : `创建图像失败（${res.status}）`,
        bodyText
      )
    );
  }
  const requestId = newOpenAiRequestId();
  const provider = args.meteringProvider || "openai-official";
  const registryId = resolveMeteringRegistryId({ model: args.model, config: args.config });
  emitOpenAiMeteredUsage({
    registryId,
    reading: meterReadingFromOpenAiImage({
      registryId,
      provider,
      raw: json,
      generatedImage: true,
    }),
    requestId,
    jobKind: "workflow_image",
  });
  return officialOpenAiImageJsonToGeminiShape(json, signal);
}

export function createOpenAiGeminiClient(
  baseUrl: string,
  apiKey: string,
  options?: { meteringProvider?: string }
): GeminiClientLike {
  const base = resolveOpenAiBaseUrl(baseUrl);
  const meteringProvider = options?.meteringProvider;
  return {
    models: {
      async generateContent(args) {
        const cfg = (args.config || {}) as Record<string, unknown>;
        const signal = cfg.abortSignal as AbortSignal | undefined;
        if (isImageGenerationModel(args.model)) {
          return openAiImageGenerateContent({
            baseUrl: base,
            apiKey,
            model: args.model,
            contents: args.contents,
            config: cfg,
            signal,
            meteringProvider,
          });
        }
        return openAiChatGenerateContent({
          baseUrl: base,
          apiKey,
          model: args.model,
          contents: args.contents,
          config: cfg,
          signal,
          meteringProvider,
        });
      },
      async *generateContentStream(args) {
        const cfg = (args.config || {}) as Record<string, unknown>;
        if (isImageGenerationModel(args.model)) {
          await openAiImageGenerateContent({
            baseUrl: base,
            apiKey,
            model: args.model,
            contents: args.contents,
            config: cfg,
            signal: cfg.abortSignal as AbortSignal | undefined,
            meteringProvider,
          });
          return;
        }
        const systemInstruction = typeof cfg.systemInstruction === "string" ? cfg.systemInstruction : undefined;
        const messages = geminiContentsToOpenAiMessages(args.contents, systemInstruction);
        const mappedModel = mapOpenAiChatModel(args.model);
        const ac = new AbortController();
        const signal = cfg.abortSignal as AbortSignal | undefined;
        if (signal) {
          if (signal.aborted) throw new Error("请求已取消");
          signal.addEventListener("abort", () => ac.abort(), { once: true });
        }
        const registryId = resolveMeteringRegistryId({ model: args.model, config: cfg });
        const requestId = newOpenAiRequestId();
        const provider = meteringProvider || "openai-official";
        const res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: mappedModel,
            messages,
            stream: true,
            stream_options: { include_usage: true },
          }),
          signal: ac.signal,
        });
        if (!res.ok) {
          const t = await res.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(t) as unknown;
          } catch {
            parsed = null;
          }
          throw new Error(parseToapisHttpErrorJson(parsed, res.status, t || `流式请求失败（${res.status}）`, t));
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("无法读取流式响应");
        const dec = new TextDecoder();
        let buf = "";
        let streamUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null =
          null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            const payload = s.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const j = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
              };
              if (j.usage && typeof j.usage === "object") streamUsage = j.usage;
              const delta = j.choices?.[0]?.delta?.content;
              if (delta) {
                yield streamUsage
                  ? { text: delta, [OPENAI_STREAM_USAGE_KEY]: streamUsage }
                  : { text: delta };
              } else if (streamUsage) {
                yield { [OPENAI_STREAM_USAGE_KEY]: streamUsage };
              }
            } catch {
              /* skip */
            }
          }
        }
        if (streamUsage) {
          emitOpenAiMeteredUsage({
            registryId,
            reading: meterReadingFromOpenAiChat({
              registryId,
              provider,
              raw: { usage: streamUsage },
            }),
            requestId,
            jobKind: "workflow_chat",
          });
        }
      },
    },
  };
}
