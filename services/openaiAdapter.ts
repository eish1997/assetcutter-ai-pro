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

export function normalizeOpenAiBaseUrl(raw: string): string {
  const s = (raw || "").trim().replace(/\/+$/, "");
  if (!s) return "https://api.openai.com/v1";
  if (/\/v1$/i.test(s)) return s;
  return `${s.replace(/\/$/, "")}/v1`;
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
const GPT_IMAGE_PROMPT_MAX_CHARS = 32000;
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

/** gpt-image-1.5 等：官方标准尺寸 */
export function aspectRatioToGptImage15Size(aspect?: string): string {
  const a = (aspect || "1:1").trim().toLowerCase();
  const wide = new Set(["16:9", "21:9", "4:3", "3:2"]);
  const tall = new Set(["9:16", "3:4", "2:3", "4:5"]);
  if (wide.has(a)) return "1536x1024";
  if (tall.has(a)) return "1024x1536";
  return "1024x1024";
}

/**
 * gpt-image-2：任意 WIDTHxHEIGHT（16 整除，宽高比 1:3～3:1）。
 * 这里为常见比例选较高分辨率默认值。
 */
export function aspectRatioToGptImage2Size(aspect?: string): string {
  const a = (aspect || "1:1").trim().toLowerCase();
  const map: Record<string, string> = {
    "1:1": "1536x1536",
    "16:9": "1536x864",
    "21:9": "1792x768",
    "4:3": "1536x1152",
    "3:2": "1536x1024",
    "9:16": "864x1536",
    "3:4": "1024x1536",
    "2:3": "1024x1536",
    "4:5": "1024x1280",
  };
  return map[a] ?? "1536x1536";
}

export function resolveGptImageSize(model: string, aspectRatio?: string): string {
  return isGptImage2Model(model) ? aspectRatioToGptImage2Size(aspectRatio) : aspectRatioToGptImage15Size(aspectRatio);
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
  return buildGeminiLikeTextResponse(text);
}

function buildGptImageRequestBody(args: {
  model: string;
  prompt: string;
  imageConfig: { aspectRatio?: string; imageSize?: string };
  inlineImages: string[];
}): Record<string, unknown> {
  const mappedModel = mapOpenAiImageModel(args.model);
  const size = resolveGptImageSize(mappedModel, args.imageConfig.aspectRatio);
  const quality = gptImageQualityFromImageSize(args.imageConfig.imageSize);
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
  return officialOpenAiImageJsonToGeminiShape(json, signal);
}

export function createOpenAiGeminiClient(baseUrl: string, apiKey: string): GeminiClientLike {
  const base = normalizeOpenAiBaseUrl(baseUrl);
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
          });
        }
        return openAiChatGenerateContent({
          baseUrl: base,
          apiKey,
          model: args.model,
          contents: args.contents,
          config: cfg,
          signal,
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
              const j = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
              const delta = j.choices?.[0]?.delta?.content;
              if (delta) yield { text: delta };
            } catch {
              /* skip */
            }
          }
        }
      },
    },
  };
}
