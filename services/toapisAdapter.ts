/**
 * ToAPIs（OpenAI 兼容网关）适配层：将本站使用的 Gemini 风格 generateContent 调用
 * 转为 ToAPIs 的 chat/completions 与异步 images/generations。
 * 文档：https://docs.toapis.com/docs/cn
 *
 * --- 与「Google Gemini 官方 SDK」路径的差异（改模型/加能力前先读）---
 *
 * 1) 路由拆分（最易出 bug）
 *    - 官方：同一 SDK，文本/多模态/生图均由 Google GenAI 协议完成。
 *    - ToAPIs：按 `isImageGenerationModel(model)` 分流：
 *      · 命中 → POST `/v1/images/generations`（异步任务 + 轮询），图生图需先 POST `/v1/uploads/images`。
 *      · 未命中 → POST `/v1/chat/completions`（OpenAI messages，vision 用 data URL）。
 *    - 新增站内「生图模型 id」时：必须同步 DEFAULT_IMAGE_MODEL_MAP，并确认启发式仍能识别为「生图模型」。
 *
 * 2) 模型 ID
 *    - 站内仍使用内部名（如 gemini-3-flash-preview、gemini-3-pro-image-preview）。
 *    - ToAPIs 侧实际请求名见 DEFAULT_TEXT_MODEL_MAP / DEFAULT_IMAGE_MODEL_MAP；未映射则原样透传（可能 400）。
 *
 * 3) 生图请求体
 *    - `image_urls` 必须为 URL 字符串数组 `["https://..."]`（文档示例），不要用 `{url}` 对象数组。
 *    - `prompt` 有长度上限（TOAPIS_IMAGE_PROMPT_MAX_CHARS），超长会截断（官方 Gemini 无此统一截断）。
 *    - `size` 仅来自 imageConfig.aspectRatio；非法比例会回退 1:1；支持的枚举需与 ToAPIs 各模型文档对齐。
 *    - `config.imageConfig.imageSize`：已映射为 `metadata.resolution`（1K/2K/4K）；2.5 Flash 生图仅支持 1K，请求 2K/4K 时会降级为 1K 以免 400。
 *
 * 4) 结构化输出
 *    - 官方：responseSchema + responseMimeType 可做强 JSON 约束。
 *    - ToAPIs：仅 `response_format: { type: "json_object" }`，无 schema；依赖提示词，边界 case 可能解析失败。
 *
 * 5) 流式
 *    - 仅 chat 路径实现 SSE；生图路径无流式（与官方「一次 generateContent」语义一致，但耗时形态是轮询）。
 *
 * 6) 浏览器与 CORS
 *    - 直连 ToAPIs 需对方允许站点来源；若失败表现为浏览器 Network 跨域，与适配逻辑无关。
 *
 * 7) 与可选 Gemini 代理（VITE_BULK_IMAGE_API → server/gemini-proxy-api.js）关系
 *    - 选择 ToAPIs 时走本适配层，不会自动改用代理的 `/proxy/gemini/async`。
 */

const IMAGE_POLL_MS = 3000;
const IMAGE_MAX_WAIT_MS = 600_000;
/** ToAPIs 图像生成接口对 prompt 的长度限制（见各模型文档） */
const TOAPIS_IMAGE_PROMPT_MAX_CHARS = 1000;

/** 本站内部模型 ID → ToAPIs Chat 模型（多模态/文本） */
const DEFAULT_TEXT_MODEL_MAP: Record<string, string> = {
  'gemini-3-flash-preview': 'gemini-3-flash-preview-official',
  'gemini-3-pro-preview': 'gemini-3-pro-preview-official',
  'gemini-2.5-flash-preview': 'gemini-2.5-flash-official',
  'gemini-2.5-pro-preview': 'gemini-2.5-pro-official',
};

/** 本站内部生图模型 → ToAPIs 图像异步接口 model */
const DEFAULT_IMAGE_MODEL_MAP: Record<string, string> = {
  'gemini-2.5-flash-image': 'gemini-2.5-flash-image-preview',
  'gemini-3-pro-image-preview': 'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview': 'gemini-3.1-flash-image-preview',
};

export function normalizeToapisBaseUrl(raw: string): string {
  const s = (raw || '').trim().replace(/\/+$/, '');
  if (!s) return 'https://toapis.com/v1';
  if (/\/v1$/i.test(s)) return s;
  return `${s}/v1`;
}

export function mapToapisTextModel(internalModel: string): string {
  return DEFAULT_TEXT_MODEL_MAP[internalModel] || internalModel;
}

export function mapToapisImageModel(internalModel: string): string {
  return DEFAULT_IMAGE_MODEL_MAP[internalModel] || internalModel;
}

function isImageGenerationModel(model: string): boolean {
  const m = model.toLowerCase();
  if (m.includes('flash-image') || m.includes('pro-image')) return true;
  if (/-image$/.test(m) && !m.includes('flash-preview') && !m.includes('pro-preview')) return true;
  return false;
}

type GeminiPart = { text?: string; inlineData?: { mimeType?: string; data?: string } };
type GeminiTurn = { role: 'user' | 'model'; parts: GeminiPart[] };

function parseContents(contents: unknown): GeminiTurn[] {
  if (Array.isArray(contents)) {
    return contents as GeminiTurn[];
  }
  if (contents && typeof contents === 'object' && Array.isArray((contents as { parts?: unknown }).parts)) {
    return [{ role: 'user', parts: (contents as { parts: GeminiPart[] }).parts }];
  }
  return [{ role: 'user', parts: [{ text: String(contents ?? '') }] }];
}

function partToOpenAIContent(p: GeminiPart): { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } {
  if (p.inlineData?.data) {
    const mime = p.inlineData.mimeType || 'image/jpeg';
    const url = `data:${mime};base64,${p.inlineData.data}`;
    return { type: 'image_url', image_url: { url } };
  }
  return { type: 'text', text: p.text ?? '' };
}

function buildOpenAIMessages(
  contents: unknown,
  systemInstruction?: string
): { role: 'system' | 'user' | 'assistant'; content: unknown }[] {
  const turns = parseContents(contents);
  const messages: { role: 'system' | 'user' | 'assistant'; content: unknown }[] = [];
  if (systemInstruction?.trim()) {
    messages.push({ role: 'system', content: systemInstruction.trim() });
  }
  for (const t of turns) {
    const role = t.role === 'model' ? 'assistant' : 'user';
    const parts = t.parts || [];
    const openaiParts = parts.map(partToOpenAIContent).filter((x) => (x.type === 'text' ? (x as { text: string }).text !== '' : true));
    if (openaiParts.length === 0) continue;
    const content = openaiParts.length === 1 && openaiParts[0].type === 'text' ? (openaiParts[0] as { text: string }).text : openaiParts;
    messages.push({ role, content });
  }
  return messages;
}

function buildGeminiLikeTextResponse(text: string): { text: string; candidates: { content: { parts: { text: string }[] } }[] } {
  return {
    text,
    candidates: [{ content: { parts: [{ text }] } }],
  };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(binary);
}

async function fetchAsDataUrl(imageUrl: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(imageUrl, { signal, mode: 'cors' });
  if (!res.ok) throw new Error(`拉取生成图失败（${res.status}）`);
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);
  const mime = blob.type || 'image/png';
  return `data:${mime};base64,${b64}`;
}

async function uploadBase64ToToapis(
  baseUrl: string,
  apiKey: string,
  base64OrDataUrl: string,
  signal?: AbortSignal
): Promise<string> {
  const parsed = base64OrDataUrl.trim().match(/^data:([^;,]+);base64,(.+)$/i);
  let mime = 'image/jpeg';
  let b64 = base64OrDataUrl;
  if (parsed) {
    mime = parsed[1] || mime;
    b64 = parsed[2] || '';
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
  const formData = new FormData();
  formData.append('file', blob, `upload.${ext}`);
  const res = await fetch(`${baseUrl}/uploads/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal,
  });
  const json = (await res.json()) as { success?: boolean; data?: { url?: string }; message?: string };
  if (!res.ok || json.success === false || !json.data?.url) {
    throw new Error(json.message || `上传参考图失败（${res.status}）`);
  }
  return json.data.url;
}

async function pollImageTask(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  signal?: AbortSignal
): Promise<string> {
  const deadline = Date.now() + IMAGE_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('请求已取消');
    const res = await fetch(`${baseUrl}/images/generations/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    const data = (await res.json()) as {
      status?: string;
      error?: { message?: string };
      result?: { data?: Array<{ url?: string }> };
    };
    if (!res.ok) {
      const msg = (data as { error?: { message?: string } }).error?.message || `查询任务失败（${res.status}）`;
      throw new Error(msg);
    }
    const st = data.status;
    if (st === 'completed') {
      const url = data.result?.data?.[0]?.url;
      if (!url) throw new Error('任务完成但未返回图片 URL');
      return url;
    }
    if (st === 'failed') {
      throw new Error(data.error?.message || '图像生成失败');
    }
    await new Promise((r) => setTimeout(r, IMAGE_POLL_MS));
  }
  throw new Error('等待图像生成超时');
}

function aspectToSize(aspect?: string): string {
  const a = (aspect || '1:1').trim();
  /** 合并 Flash / Pro 文档中的比例枚举；未知值回退 1:1，避免 400 */
  const allowed = new Set([
    '1:1',
    '16:9',
    '9:16',
    '4:3',
    '3:4',
    '3:2',
    '2:3',
    '4:5',
    '5:4',
    '21:9',
  ]);
  return allowed.has(a) ? a : '1:1';
}

/** 站内 imageSize（1K/2K/4K）→ ToAPIs metadata.resolution；2.5 Flash 仅文档支持 1K */
function toapisImageMetadataResolution(
  imageSize: string | undefined,
  mappedModel: string
): { resolution: '1K' | '2K' | '4K' } | undefined {
  const raw = (imageSize || '').trim().toUpperCase();
  let resolution: '1K' | '2K' | '4K' | undefined;
  if (raw === '1K' || raw === '2K' || raw === '4K') {
    resolution = raw;
  }
  const isFlash25Image = mappedModel.includes('2.5-flash-image');
  if (isFlash25Image) {
    if (resolution && resolution !== '1K') {
      resolution = '1K';
    }
    return resolution ? { resolution } : undefined;
  }
  return resolution ? { resolution } : undefined;
}

function parseToapisHttpErrorJson(json: unknown, status: number, fallback: string): string {
  if (!json || typeof json !== 'object') return fallback;
  const o = json as Record<string, unknown>;
  const err = o.error;
  if (err && typeof err === 'object') {
    const m = (err as { message?: string }).message;
    if (typeof m === 'string' && m.trim()) return m.trim();
  }
  if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
  try {
    return JSON.stringify(json);
  } catch {
    return fallback || `请求失败（${status}）`;
  }
}

async function toapisImageGenerateContent(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<{ text?: string; candidates?: unknown[] }> {
  const cfg = args.config || {};
  const systemInstruction = typeof cfg.systemInstruction === 'string' ? cfg.systemInstruction : '';
  const imageConfig = (cfg.imageConfig || {}) as { aspectRatio?: string; imageSize?: string };
  const size = aspectToSize(imageConfig.aspectRatio);
  const mappedModel = mapToapisImageModel(args.model);
  const metaRes = toapisImageMetadataResolution(imageConfig.imageSize, mappedModel);

  const turns = parseContents(args.contents);
  const userParts = turns.find((t) => t.role === 'user')?.parts || turns[0]?.parts || [];
  const textPieces: string[] = [];
  const inlineImages: string[] = [];
  for (const p of userParts) {
    if (p.text) textPieces.push(p.text);
    if (p.inlineData?.data) {
      const mime = p.inlineData.mimeType || 'image/jpeg';
      inlineImages.push(`data:${mime};base64,${p.inlineData.data}`);
    }
  }
  const userText = textPieces.join('\n').trim();
  let prompt = [systemInstruction.trim(), userText].filter(Boolean).join('\n\n').trim();
  if (!prompt) throw new Error('生图提示词为空');
  if (prompt.length > TOAPIS_IMAGE_PROMPT_MAX_CHARS) {
    prompt = prompt.slice(0, TOAPIS_IMAGE_PROMPT_MAX_CHARS);
  }

  /** ToAPIs 文档示例为 URL 字符串数组，对象形式会导致 400 */
  const imageUrlStrings: string[] = [];
  for (const dataUrl of inlineImages) {
    const url = await uploadBase64ToToapis(args.baseUrl, args.apiKey, dataUrl, args.signal);
    imageUrlStrings.push(url);
  }

  const body: Record<string, unknown> = {
    model: mappedModel,
    prompt,
    size,
    n: 1,
  };
  if (metaRes) {
    body.metadata = { ...metaRes };
  }
  if (imageUrlStrings.length > 0) {
    body.image_urls = imageUrlStrings;
  }

  const createRes = await fetch(`${args.baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });
  let createJson: unknown;
  try {
    createJson = await createRes.json();
  } catch {
    createJson = null;
  }
  if (!createRes.ok) {
    throw new Error(
      parseToapisHttpErrorJson(createJson, createRes.status, `创建图像任务失败（${createRes.status}）`)
    );
  }
  const taskId = (createJson as { id?: string })?.id;
  if (!taskId) throw new Error('未返回图像任务 ID');

  const outUrl = await pollImageTask(args.baseUrl, args.apiKey, taskId, args.signal);
  const dataUrl = await fetchAsDataUrl(outUrl, args.signal);
  const base64Part = dataUrl.split(',')[1] || '';
  return {
    text: undefined,
    candidates: [
      {
        content: {
          parts: [{ inlineData: { mimeType: 'image/png', data: base64Part } }],
        },
      },
    ],
  };
}

async function toapisChatGenerateContent(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<{ text?: string; candidates?: unknown[] }> {
  const cfg = args.config || {};
  const systemInstruction = typeof cfg.systemInstruction === 'string' ? cfg.systemInstruction : undefined;
  const responseMimeType = cfg.responseMimeType as string | undefined;
  const messages = buildOpenAIMessages(args.contents, systemInstruction);
  const mappedModel = mapToapisTextModel(args.model);

  const body: Record<string, unknown> = {
    model: mappedModel,
    messages,
  };
  if (responseMimeType === 'application/json') {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${args.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: cfg.abortSignal as AbortSignal | undefined,
  });
  const raw = await res.text();
  if (!res.ok) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = null;
    }
    throw new Error(parseToapisHttpErrorJson(parsed, res.status, raw || `Chat 请求失败（${res.status}）`));
  }
  let parsed: { choices?: Array<{ message?: { content?: string } }> };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error('Chat 响应不是合法 JSON');
  }
  const text = parsed.choices?.[0]?.message?.content ?? '';
  return buildGeminiLikeTextResponse(typeof text === 'string' ? text : String(text));
}

export type GeminiClientLike = {
  models: {
    generateContent: (args: { model: string; contents: unknown; config?: Record<string, unknown> }) => Promise<unknown>;
    generateContentStream?: (args: {
      model: string;
      contents: unknown;
      config?: Record<string, unknown>;
    }) => AsyncIterable<{ text?: string }>;
  };
};

export function createToapisGeminiClient(baseUrl: string, apiKey: string): GeminiClientLike {
  const base = normalizeToapisBaseUrl(baseUrl);
  return {
    models: {
      async generateContent(args) {
        const cfg = (args.config || {}) as Record<string, unknown>;
        const signal = cfg.abortSignal as AbortSignal | undefined;
        if (isImageGenerationModel(args.model)) {
          return toapisImageGenerateContent({
            baseUrl: base,
            apiKey,
            model: args.model,
            contents: args.contents,
            config: cfg,
            signal,
          });
        }
        return toapisChatGenerateContent({
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
        const systemInstruction = typeof cfg.systemInstruction === 'string' ? cfg.systemInstruction : undefined;
        const messages = buildOpenAIMessages(args.contents, systemInstruction);
        const mappedModel = mapToapisTextModel(args.model);
        const ac = new AbortController();
        const signal = cfg.abortSignal as AbortSignal | undefined;
        if (signal) {
          if (signal.aborted) throw new Error('请求已取消');
          signal.addEventListener('abort', () => ac.abort(), { once: true });
        }
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
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
          throw new Error(parseToapisHttpErrorJson(parsed, res.status, t || `流式请求失败（${res.status}）`));
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error('无法读取流式响应');
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith('data:')) continue;
            const payload = s.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const j = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
              const delta = j.choices?.[0]?.delta?.content;
              if (delta) yield { text: delta };
            } catch {
              // skip bad chunk
            }
          }
        }
      },
    },
  };
}
