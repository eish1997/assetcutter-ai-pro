/**
 * OpenAI 官方 HTTP API 适配：Chat Completions + Images（文生图 / 单张参考图编辑）。
 * 对齐站内 `GeminiClientLike`（`generateContent` / `generateContentStream`）。
 *
 * @see https://platform.openai.com/docs/api-reference/chat
 * @see https://platform.openai.com/docs/api-reference/images
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

export function mapOpenAiImageModel(model: string): string {
  const m = (model || "").trim();
  const ml = m.toLowerCase();
  if (!m) return "gpt-image-1";
  if (ml.includes("gpt-image") || ml.includes("dall-e")) return m;
  return "gpt-image-1";
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

const OPENAI_IMAGE_PROMPT_MAX_CHARS = 4000;

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

/** DALL·E 3 / 常见 OpenAI 图像接口：`1024x1024`、`1792x1024`、`1024x1792` */
function aspectRatioToOpenAiImageSize(aspect?: string): string {
  const a = (aspect || "1:1").trim().toLowerCase();
  const wide = new Set(["16:9", "21:9", "4:3", "3:2"]);
  const tall = new Set(["9:16", "3:4", "2:3", "4:5"]);
  if (wide.has(a)) return "1792x1024";
  if (tall.has(a)) return "1024x1792";
  return "1024x1024";
}

function dataUrlToBlobAndFilename(dataUrl: string): { blob: Blob; filename: string } {
  const parsed = dataUrl.trim().match(/^data:([^;,]+);base64,(.+)$/i);
  let mime = "image/jpeg";
  let b64 = dataUrl.replace(/\s/g, "");
  if (parsed) {
    mime = parsed[1] || mime;
    b64 = parsed[2] || "";
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "jpg";
  return { blob: new Blob([bytes], { type: mime }), filename: `ref.${ext}` };
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
  throw new Error("图像响应中无 data[0].b64_json 或 url（OpenAI 官方接口一般为同步 JSON）");
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

/**
 * 官方 Images：`generations` 文生图；`edits` 仅传**首张**参考图（多图时其余忽略，与部分 OpenAI 接口一致）。
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
  const imageConfig = (cfg.imageConfig || {}) as { aspectRatio?: string };
  const mappedModel = mapOpenAiImageModel(args.model);
  const size = aspectRatioToOpenAiImageSize(imageConfig.aspectRatio);

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
  const prompt = clampOpenAiImagePrompt(systemInstruction, userText, OPENAI_IMAGE_PROMPT_MAX_CHARS);
  if (!prompt) throw new Error("生图提示词为空");

  const signal = (cfg.abortSignal as AbortSignal | undefined) ?? args.signal;

  if (inlineImages.length > 0) {
    const form = new FormData();
    form.append("model", mappedModel);
    form.append("prompt", prompt);
    form.append("n", "1");
    form.append("size", size);
    form.append("response_format", "b64_json");
    const { blob, filename } = dataUrlToBlobAndFilename(inlineImages[0]!);
    form.append("image", blob, filename);

    const editRes = await fetch(`${args.baseUrl}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}` },
      body: form,
      signal,
    });
    const { json: editJson, text: editBodyText } = await readResponseBody(editRes);
    if (!editRes.ok) {
      throw new Error(
        parseToapisHttpErrorJson(
          editJson,
          editRes.status,
          `图像编辑失败（${editRes.status}）`,
          editBodyText
        )
      );
    }
    return officialOpenAiImageJsonToGeminiShape(editJson, signal);
  }

  const createRes = await fetch(`${args.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: mappedModel,
      prompt,
      n: 1,
      size,
      response_format: "b64_json",
    }),
    signal,
  });
  const { json: createJson, text: createBodyText } = await readResponseBody(createRes);
  if (!createRes.ok) {
    throw new Error(
      parseToapisHttpErrorJson(
        createJson,
        createRes.status,
        `创建图像失败（${createRes.status}）`,
        createBodyText
      )
    );
  }
  return officialOpenAiImageJsonToGeminiShape(createJson, signal);
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
