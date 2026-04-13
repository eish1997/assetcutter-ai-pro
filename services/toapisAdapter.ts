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
 *    - ToAPIs：`image_urls` 为 URL 字符串数组 `["https://..."]`（须先 `/uploads/images`），勿用 `{url}` 对象。
 *    - Antigravity 图生图：**multipart `/images/edits`** 的 `image1`…，勿依赖 generations JSON 的 `image_urls`（上游不读）。
 *    - `prompt` 有长度上限（TOAPIS_IMAGE_PROMPT_MAX_CHARS），超长会截断（官方 Gemini 无此统一截断）。
 *    - `size` 来自 imageConfig.aspectRatio：ToAPIs 用比例枚举（如 `16:9`）；**Antigravity（skipToapisImageUpload）须 `WIDTHxHEIGHT`**（见 aspectRatioToAntigravityWxH）。
 *    - `config.imageConfig.imageSize`：ToAPIs 映射为 `metadata.resolution`（1K/2K/4K）；Antigravity 映射为 OpenAI **`quality`**（standard/medium/hd）；2.5 Flash 生图仅 1K，quality 固定 standard。
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
 *
 * 8) Antigravity Tools（本机 OpenAI 兼容反代，与 GitHub `openai.rs` 对齐）
 *    - **文生图**：`POST /v1/images/generations`（JSON：`prompt/model/n/size/quality/response_format`，**无 `image_urls` 参与上游**，多余字段仅被忽略）。
 *    - **图生图**：须 `POST /v1/images/edits`（**multipart**：`prompt`、`model`、`image1`/`image2`… 参考图文件、`aspect_ratio` 或 `size`、`image_size` 等）；勿把参考图只塞进 generations 的 JSON。
 *    - `skipToapisImageUpload`：无 `/v1/uploads/images`；有参考图时走 **edits** multipart，无参考图走 **generations** JSON。
 *    - 生图响应若含 `data[0].b64_json` / `url`，与 ToAPIs 相同解析；否则再轮询 `id`。
 */

const IMAGE_POLL_MS = 3000;
const IMAGE_MAX_WAIT_MS = 600_000;
/** ToAPIs 图像生成接口对 prompt 的长度限制（见各模型文档；过长时用 clampToapisImagePrompt 优先保留用户指令） */
const TOAPIS_IMAGE_PROMPT_MAX_CHARS = 1000;

/** 合并 system + user 提示词并压到上限：禁止仅用 slice(0,max) 从头部截断，否则会丢掉末尾的用户任务描述，易触发上游「无图」类错误 */
function clampToapisImagePrompt(systemInstruction: string, userText: string, max: number): string {
  const sys = systemInstruction.trim();
  const usr = userText.trim();
  const combined = [sys, usr].filter(Boolean).join('\n\n').trim();
  if (!combined) return '';
  if (combined.length <= max) return combined;
  if (!usr) return sys.slice(0, max);
  if (usr.length >= max) return usr.slice(0, max);
  const sep = sys ? '\n\n' : '';
  const budget = max - usr.length - sep.length;
  if (budget <= 0) return usr;
  return sys ? `${sys.slice(0, budget)}${sep}${usr}` : usr;
}

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

/** 读一次 body，同时得到 JSON（若可解析）与原文，便于错误分支展示纯文本（如 Antigravity 返回非 JSON 的 429 说明） */
async function readResponseBody(res: Response): Promise<{ json: unknown | null; text: string }> {
  const text = await res.text();
  const t = text.trim();
  if (!t) return { json: null, text: '' };
  try {
    return { json: JSON.parse(t) as unknown, text: t };
  } catch {
    return { json: null, text: t };
  }
}

/** 避免对空 body 调用 `Response.json()`（浏览器报 Failed to execute 'json' on 'Response'） */
async function readResponseJson(res: Response): Promise<unknown | null> {
  const { json } = await readResponseBody(res);
  return json;
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
  const json = (await readResponseJson(res)) as { success?: boolean; data?: { url?: string }; message?: string } | null;
  if (!json) {
    throw new Error(`上传参考图失败（${res.status}）：响应体为空或非 JSON`);
  }
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
    const data = (await readResponseJson(res)) as {
      status?: string;
      error?: { message?: string };
      result?: { data?: Array<{ url?: string }> };
    } | null;
    if (!res.ok) {
      const msg =
        (data as { error?: { message?: string } } | null)?.error?.message ||
        (data == null ? `查询任务失败（${res.status}）：空响应` : `查询任务失败（${res.status}）`);
      throw new Error(msg);
    }
    if (!data) {
      throw new Error(`查询任务失败（${res.status}）：响应体为空`);
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

/**
 * Antigravity / Imagen 的 OpenAI Images 映射：`size` 须为 `WIDTHxHEIGHT`。
 * 若传 `16:9` 等比例字符串，代理会解析失败并回退 1:1，极端情况可致上游异常（如 502）。
 * @see https://opencodedocs.com/lbjlaq/Antigravity-Manager/platforms/imagen
 */
function aspectRatioToAntigravityWxH(aspect?: string): string {
  const a = (aspect || '1:1').trim().toLowerCase();
  const map: Record<string, string> = {
    '1:1': '1024x1024',
    '16:9': '1920x1080',
    '9:16': '1080x1920',
    '4:3': '800x600',
    '3:4': '600x800',
    '3:2': '768x512',
    '2:3': '512x768',
    '4:5': '1024x1280',
    '5:4': '1280x1024',
    '21:9': '2560x1080',
  };
  return map[a] || '1024x1024';
}

/** skipToapisImageUpload 路径：用 OpenAI `quality` 映射分辨率档，勿发 ToAPIs 专用 `metadata` */
function imageSizeToOpenAiQuality(
  imageSize: string | undefined,
  mappedModel: string
): 'standard' | 'medium' | 'hd' {
  const isFlash25Image = mappedModel.includes('2.5-flash-image');
  if (isFlash25Image) return 'standard';
  const raw = (imageSize || '').trim().toUpperCase();
  if (raw === '4K' || raw === '4') return 'hd';
  if (raw === '2K' || raw === '2') return 'medium';
  return 'standard';
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

/** Antigravity-Manager 等在账号轮询失败后返回的文案；附简短排查提示（问题在反代/网络/账号，非本站业务逻辑） */
function enrichOpenAiGatewayErrorMessage(msg: string): string {
  const m = (msg || '').trim();
  if (!m) return msg;
  if (/All accounts exhausted/i.test(m)) {
    return `${m}（说明：Antigravity 反代访问 Google 上游 cloudcode-pa.googleapis.com 失败，账号池已全部重试。请在本机检查 Antigravity-Manager 的账号、代理/VPN、防火墙及反代日志。）`;
  }
  if (/cloudcode-pa\.googleapis\.com|\/v1internal/i.test(m) && /error sending|request failed|failed to connect|connection/i.test(m)) {
    return `${m}（说明：多为运行 Antigravity 的环境无法稳定连上 Google API，请检查系统代理是否对该域名生效、DNS 与 TLS。）`;
  }
  return msg;
}

/**
 * @param rawBodyText 响应原文（非 JSON 时仍可读，如 Antigravity 纯文本错误）
 */
function parseToapisHttpErrorJson(
  json: unknown,
  status: number,
  fallback: string,
  rawBodyText?: string
): string {
  const raw = (rawBodyText || '').trim();
  if (!json || typeof json !== 'object') {
    const fromText = raw ? (raw.length > 1200 ? `${raw.slice(0, 1200)}…` : raw) : '';
    return enrichOpenAiGatewayErrorMessage(fromText || fallback);
  }
  const o = json as Record<string, unknown>;
  const err = o.error;
  if (typeof err === 'string' && err.trim()) {
    const msg = err.trim();
    if (/Use POST \/jobs/i.test(msg)) {
      return `${msg}（当前 ToAPIs Base URL 似乎指向了其他服务。请在设置中将 ToAPIs Base URL 改为包含 /v1 的网关地址，例如 https://toapis.com/v1）`;
    }
    return enrichOpenAiGatewayErrorMessage(msg);
  }
  if (err && typeof err === 'object') {
    const m = (err as { message?: string }).message;
    if (typeof m === 'string' && m.trim()) return enrichOpenAiGatewayErrorMessage(m.trim());
  }
  if (typeof o.message === 'string' && o.message.trim()) return enrichOpenAiGatewayErrorMessage(o.message.trim());
  try {
    return enrichOpenAiGatewayErrorMessage(JSON.stringify(json));
  } catch {
    return enrichOpenAiGatewayErrorMessage(fallback || `请求失败（${status}）`);
  }
}

function dataUrlToBlobAndFilename(dataUrl: string): { blob: Blob; filename: string } {
  const parsed = dataUrl.trim().match(/^data:([^;,]+);base64,(.+)$/i);
  let mime = 'image/jpeg';
  let b64 = dataUrl.replace(/\s/g, '');
  if (parsed) {
    mime = parsed[1] || mime;
    b64 = parsed[2] || '';
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
  return { blob: new Blob([bytes], { type: mime }), filename: `ref.${ext}` };
}

/** Antigravity `handle_images_edits`  multipart 字段 `image_size`（1K/2K/4K） */
function antigravityEditsFormImageSize(imageSize: string | undefined, mappedModel: string): string | undefined {
  if (mappedModel.includes('2.5-flash-image')) return '1K';
  const raw = (imageSize || '').trim().toUpperCase();
  if (raw === '4K' || raw === '4') return '4K';
  if (raw === '2K' || raw === '2') return '2K';
  if (raw === '1K' || raw === '1') return '1K';
  return undefined;
}

async function resolveOpenAiImageJsonToCandidates(
  createJson: unknown,
  ctx: { baseUrl: string; apiKey: string; signal?: AbortSignal }
): Promise<{ text?: string; candidates: unknown[] }> {
  const cj = createJson as {
    id?: string;
    data?: Array<{ url?: string; b64_json?: string }>;
  };
  const sync0 = Array.isArray(cj.data) ? cj.data[0] : undefined;
  if (sync0?.b64_json && String(sync0.b64_json).trim()) {
    return {
      text: undefined,
      candidates: [
        {
          content: {
            parts: [{ inlineData: { mimeType: 'image/png', data: String(sync0.b64_json).trim() } }],
          },
        },
      ],
    };
  }
  if (sync0?.url && String(sync0.url).trim()) {
    const dataUrl = await fetchAsDataUrl(String(sync0.url).trim(), ctx.signal);
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
  const taskId = cj?.id;
  if (!taskId) throw new Error('未返回图像任务 ID（且响应中无 OpenAI 风格 data[0].b64_json/url）');
  const outUrl = await pollImageTask(ctx.baseUrl, ctx.apiKey, taskId, ctx.signal);
  const dataUrl = await fetchAsDataUrl(outUrl, ctx.signal);
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

async function toapisImageGenerateContent(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  signal?: AbortSignal;
  mapImageModel?: (internal: string) => string;
  /** Antigravity 等无 `/v1/uploads/images`：参考图直接塞 data URL，勿先上传换 HTTPS 链 */
  skipToapisImageUpload?: boolean;
}): Promise<{ text?: string; candidates?: unknown[] }> {
  const cfg = args.config || {};
  const systemInstruction = typeof cfg.systemInstruction === 'string' ? cfg.systemInstruction : '';
  const imageConfig = (cfg.imageConfig || {}) as { aspectRatio?: string; imageSize?: string };
  const useAntigravityImageShape = args.skipToapisImageUpload === true;
  const size = useAntigravityImageShape
    ? aspectRatioToAntigravityWxH(imageConfig.aspectRatio)
    : aspectToSize(imageConfig.aspectRatio);
  const mapImg = args.mapImageModel ?? mapToapisImageModel;
  const mappedModel = mapImg(args.model);
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
  let prompt = clampToapisImagePrompt(systemInstruction, userText, TOAPIS_IMAGE_PROMPT_MAX_CHARS);
  if (!prompt) throw new Error('生图提示词为空');

  /**
   * Antigravity：`/images/generations` 上游只用纯文本 prompt，**不读 `image_urls`**。
   * 图生图须走 `/images/edits`（multipart，`image1`…），见 lbjlaq/Antigravity-Manager `handle_images_edits`。
   */
  if (useAntigravityImageShape && inlineImages.length > 0) {
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('model', mappedModel);
    form.append('n', '1');
    form.append('response_format', 'b64_json');
    form.append('aspect_ratio', aspectToSize(imageConfig.aspectRatio));
    const isz = antigravityEditsFormImageSize(imageConfig.imageSize, mappedModel);
    if (isz) form.append('image_size', isz);
    inlineImages.forEach((du, i) => {
      const { blob, filename } = dataUrlToBlobAndFilename(du);
      form.append(`image${i + 1}`, blob, filename);
    });
    const editRes = await fetch(`${args.baseUrl}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.apiKey}` },
      body: form,
      signal: args.signal,
    });
    const { json: editJson, text: editBodyText } = await readResponseBody(editRes);
    if (!editRes.ok) {
      throw new Error(
        parseToapisHttpErrorJson(
          editJson,
          editRes.status,
          `图像编辑/参考图生图失败（${editRes.status}）`,
          editBodyText
        )
      );
    }
    return resolveOpenAiImageJsonToCandidates(editJson, {
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      signal: args.signal,
    });
  }

  /** ToAPIs：先 POST /uploads/images 换 URL；Antigravity 文生图无参考图则不走 uploads */
  const imageUrlStrings: string[] = [];
  if (args.skipToapisImageUpload === true) {
    imageUrlStrings.push(...inlineImages);
  } else {
    for (const dataUrl of inlineImages) {
      const url = await uploadBase64ToToapis(args.baseUrl, args.apiKey, dataUrl, args.signal);
      imageUrlStrings.push(url);
    }
  }

  const body: Record<string, unknown> = {
    model: mappedModel,
    prompt,
    size,
    n: 1,
  };
  if (useAntigravityImageShape) {
    body.response_format = 'b64_json';
    body.quality = imageSizeToOpenAiQuality(imageConfig.imageSize, mappedModel);
  } else if (metaRes) {
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
  const { json: createJson, text: createBodyText } = await readResponseBody(createRes);
  if (!createRes.ok) {
    throw new Error(
      parseToapisHttpErrorJson(
        createJson,
        createRes.status,
        `创建图像任务失败（${createRes.status}）`,
        createBodyText
      )
    );
  }

  return resolveOpenAiImageJsonToCandidates(createJson, {
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    signal: args.signal,
  });
}

/**
 * 解析 OpenAI 兼容 chat/completions 的 HTTP 正文：标准 JSON，或部分网关误返回的 SSE（data: 行）。
 * 空 body 时避免裸 `JSON.parse('')`（浏览器报 Unexpected end of JSON input / Failed to execute 'json' on 'Response'）。
 */
function parseOpenAiChatCompletionsBody(raw: string): { choices?: Array<{ message?: { content?: unknown } }> } {
  const t = (raw || '').trim();
  if (!t) {
    throw new Error(
      'Chat 响应体为空（请确认 Antigravity 反代已启动，且 Base URL 指向 /v1/chat/completions 可达地址）'
    );
  }
  try {
    return JSON.parse(t) as { choices?: Array<{ message?: { content?: unknown } }> };
  } catch {
    /* 非整段 JSON：尝试按 SSE 聚合 */
  }
  if (!/\bdata:\s*/i.test(t)) {
    throw new Error(`Chat 响应不是合法 JSON：${t.slice(0, 120)}${t.length > 120 ? '…' : ''}`);
  }
  const parts: string[] = [];
  for (const line of t.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const payload = s.slice(5).trim();
    if (payload === '[DONE]') continue;
    let j: { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
    try {
      j = JSON.parse(payload) as typeof j;
    } catch {
      continue;
    }
    const ch0 = j.choices?.[0];
    const d = ch0?.delta?.content;
    const m = ch0?.message?.content;
    if (typeof d === 'string' && d) parts.push(d);
    else if (typeof m === 'string' && m) parts.push(m);
  }
  const merged = parts.join('');
  if (!merged.trim()) {
    throw new Error(
      'Chat 返回为 SSE 流但未解析到助手正文（已在请求中强制 stream:false；若仍如此请检查网关配置）'
    );
  }
  return { choices: [{ message: { content: merged } }] };
}

async function toapisChatGenerateContent(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  signal?: AbortSignal;
  mapTextModel?: (internal: string) => string;
}): Promise<{ text?: string; candidates?: unknown[] }> {
  const cfg = args.config || {};
  const systemInstruction = typeof cfg.systemInstruction === 'string' ? cfg.systemInstruction : undefined;
  const responseMimeType = cfg.responseMimeType as string | undefined;
  const messages = buildOpenAIMessages(args.contents, systemInstruction);
  const mapTxt = args.mapTextModel ?? mapToapisTextModel;
  const mappedModel = mapTxt(args.model);

  const body: Record<string, unknown> = {
    model: mappedModel,
    messages,
    /** 部分反代默认流式，整段 `res.text()` 会得到非 JSON，导致解析失败 */
    stream: false,
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
      parsed = raw.trim() ? (JSON.parse(raw) as unknown) : null;
    } catch {
      parsed = null;
    }
    throw new Error(
      parseToapisHttpErrorJson(parsed, res.status, raw || `Chat 请求失败（${res.status}）`, raw)
    );
  }
  const parsed = parseOpenAiChatCompletionsBody(raw);
  const content = parsed.choices?.[0]?.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : content != null
        ? String(content)
        : '';
  return buildGeminiLikeTextResponse(text);
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

/** Antigravity 等在网关侧自行映射模型：勿使用 ToAPIs 的 *-official 等后缀改写 */
export type CreateToapisGeminiClientOptions = {
  passthroughModels?: boolean;
  /** 为 true 时不请求 ToAPIs `/uploads/images`；Antigravity 下文生图走 JSON，**有参考图**走 `/images/edits` multipart */
  skipToapisImageUpload?: boolean;
};

export function createToapisGeminiClient(
  baseUrl: string,
  apiKey: string,
  options?: CreateToapisGeminiClientOptions
): GeminiClientLike {
  const base = normalizeToapisBaseUrl(baseUrl);
  const mapTextModel = options?.passthroughModels === true ? (m: string) => m : mapToapisTextModel;
  const mapImageModel = options?.passthroughModels === true ? (m: string) => m : mapToapisImageModel;
  const skipToapisImageUpload = options?.skipToapisImageUpload === true;
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
            mapImageModel,
            skipToapisImageUpload,
          });
        }
        return toapisChatGenerateContent({
          baseUrl: base,
          apiKey,
          model: args.model,
          contents: args.contents,
          config: cfg,
          signal,
          mapTextModel,
        });
      },
      async *generateContentStream(args) {
        const cfg = (args.config || {}) as Record<string, unknown>;
        const systemInstruction = typeof cfg.systemInstruction === 'string' ? cfg.systemInstruction : undefined;
        const messages = buildOpenAIMessages(args.contents, systemInstruction);
        const mappedModel = mapTextModel(args.model);
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
          throw new Error(
            parseToapisHttpErrorJson(parsed, res.status, t || `流式请求失败（${res.status}）`, t)
          );
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
