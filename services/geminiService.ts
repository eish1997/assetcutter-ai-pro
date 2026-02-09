import { GoogleGenAI, Type } from "@google/genai";
import { getApiKey } from "./settingsStore";

const getAI = () => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("未配置 API 密钥，请在设置页填写 Gemini API Key");
  return new GoogleGenAI({ apiKey });
};

export const DEFAULT_PROMPTS = {
  /** 对话生图：按指令修改图片时的系统提示（占位符 {instruction}） */
  edit: `[HIGH PRECISION EDITING PROTOCOL]
      Modify this image according to the user instruction with surgical accuracy.
      Maintain the core object's geometry, scale, and lighting consistency.
      Ensure the output is high-definition, sharp, and free of artifacts.
      Instruction: {instruction}`,
  texture_pattern: `[纹理花纹平面提取协议 - 严格执行]
      1. **核心目标**：仅提取并“展平”图像中的装饰性图案、纹理或Logo。
      2. **形变纠正（展平）**：必须消除由于物体表面曲率（如花瓶的圆周、布料的褶皱）引起的透视缩短 and 弯曲。将图案像“剥皮”或“UV展开”一样平铺在正交的平面坐标系中。
      3. **彻底剔除载体**：严禁出现任何关于原物体的轮廓、边缘、体积感、高光或阴影。输出结果不应让人看出它是从什么形状的物体上提取 of 提取的。
      4. **线稿转换**：输出高精细度的黑白灰线稿。背景必须为纯黑色 (#000000)，图案为白色或深浅不一的灰色。
      5. **智能修复与补全**：分析图案的对称性和循环规律，自动修复被切断或遮挡的线条，补全为一个完整、对称、美观的图案单元。
      6. **风格要求**：工业级 Stencil/Line-art 风格，线条边缘锐利，无杂点，无任何3D材质感。`,
  texture_tileable: `[智能无缝平铺引擎协议 - 深度增强]
      1. **纹理结构解构**：深入分析输入图像的微观纹理单元及其宏观排列逻辑。识别其核心的重复模式（Pattern Unit）。
      2. **内容精炼**：智能识别并彻底剔除多余的杂质、阴影、光斑或非规律性的干扰元素。只保留最具代表性的纹理核心。
      3. **逻辑重组与组合**：将提取出的核心单元进行规律性的平铺重组。如果当前纹理单元存在方向性，请根据视觉美学逻辑自动旋转、翻转或错位排列这些元素，以打破单调感并增强衔接自然度。
      4. **无缝衔接合成**：在合成过程中，确保四个边缘的像素能够完美闭环对接。在无限平铺时，不得出现任何视觉断层或明显的接缝线。
      5. **输出规格**：生成一张完全展平、无透视畸变、光影中和的正方形 2K 贴图。`,
  texture_pbr: `SYNTHESIZE PBR MATERIAL MAP: {mapType}.
      Based on the input image, generate a professional {mapType} map.
      Normal Map: Standard tangent space (purple/blue).
      Roughness: Grayscale where white is rough and black is smooth.
      Height: Grayscale depth map.
      Metalness: Grayscale binary mask.
      Output ONLY the specified map as a high-fidelity texture.`,
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
  dialog_title: `用 2～4 个中文字概括成会话标题。**优先以画面中的物体、主体或场景命名**（如：大门、人物、建筑、星空），不要以操作描述命名。
只输出标题文字，不要标点、不要解释、不要引号。`,
  /** 擂台 V2：根据自然语言描述生成两条生图用英文提示词（每条都与用户上传图一起送生图模型，故须为「针对该图的编辑/变换」指令） */
  arena_ab: `You are a prompt engineer for an image-generation model. The user has already uploaded ONE image and will give a short natural language description of what they want. Each prompt you output will be sent to the image model TOGETHER with that same uploaded image. Therefore every prompt MUST be an instruction to modify, transform, or edit THAT image (e.g. "transform this image into...", "based on this image, make it more...", "restyle the image to..."). Do NOT output standalone text-to-image prompts that describe a new scene from scratch and ignore the uploaded image.

First, in 1-3 sentences, briefly explain your reasoning and how you will create two distinct alternatives that both refer to modifying the uploaded image (e.g. different style or emphasis). Then output exactly two English prompts (promptA, promptB). Both should match the user's intent and both must be clearly instructions that use the uploaded image as the base.

Output ONLY a valid JSON object with these keys (all strings):
- "reasoning": your short reasoning (required).
- "promptA": first English prompt (must be an edit/transform instruction for the uploaded image).
- "promptB": second English prompt (must be an edit/transform instruction for the uploaded image).
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
  /** 擂台：根据自然语言描述生成 N 条（2/3/4）生图用英文提示词；每条都与用户上传图一起送生图模型，故须为「针对该图的编辑/变换」指令 */
  arena_ab_n: `You are a prompt engineer for an image-generation model. The user has already uploaded ONE image and will give a short natural language description. You must output exactly N alternative prompts in English (N will be 2, 3, or 4). Each prompt will be sent to the image model TOGETHER with that same uploaded image. Therefore every prompt MUST be an instruction to modify, transform, or edit THAT image (e.g. "transform this image into...", "based on this image..."). Do NOT output standalone text-to-image prompts that ignore the uploaded image.

First, in 1-3 sentences, briefly explain your reasoning and how you will create N distinct alternatives that all refer to modifying the uploaded image. Then output exactly N prompts. All should match the user's intent and differ in wording, style, or emphasis—but each must clearly be an edit/transform instruction for the uploaded image.

Output ONLY a valid JSON object. Required keys:
- "reasoning": your short reasoning (string).
- "promptA", "promptB": first two English prompts (always present; each must be an edit/transform instruction for the uploaded image).
- "promptC": third English prompt (present when N>=3).
- "promptD": fourth English prompt (present when N>=4).
No markdown, no code fence, no other text.`,
  /** 擂台：根据全量信息生成一名新挑战者提示词（用户意图 + 当前擂主 + 已有全部提示词），并输出推理过程 */
  arena_new_challenger: `You are a prompt engineer. You will receive: (1) the original user intent, (2) the current champion (winner) prompt, (3) a list of all other prompts already seen in this arena. Your task: create ONE new image-generation prompt in English that serves as a new "challenger". It should align with user intent, learn from the champion's strengths, but be clearly distinct from the champion and from all existing prompts (do not repeat or copy). Aim for a prompt that could produce a different yet valid interpretation.

First, in 1-3 sentences, explain your reasoning: how you used the context and how your new prompt differs. Then output the new prompt.

Output ONLY a valid JSON object with keys (both strings):
- "reasoning": your short reasoning.
- "prompt": the new English image-generation prompt (one line).
No markdown, no code fence, no other text.`,
  /** 结构化复现：将一条生图提示词拆成主体/场景/风格/修饰，见 PROMPT_SCORING_DESIGN §6.1 */
  parse_structured: `You are an expert at analyzing image-generation prompts. Given one English prompt, split it into four parts (output ONLY a valid JSON object, no markdown):
- "subject": the main object, character, or scene being depicted (what to draw). Keep the core description here.
- "scene": setting/background (e.g. studio, outdoors, neutral grey background, in a room).
- "style": artistic or technical style (e.g. concept art, cinematic, PBR, photorealistic, orthographic, game asset, model sheet, in the style of X).
- "modifiers": camera/lighting/quality terms (e.g. close-up, 4k, HDR, sharp, detailed).

Use empty string "" for any part that is absent. Preserve original wording; do not translate. Output ONLY the JSON object with keys subject, scene, style, modifiers.`
};

/** 对话生图：收口函数，返回实际发给模型的完整 prompt；业务代码不直接拼字符串。 */
export function getEditPrompt(instruction: string, customTemplate?: string): string {
  const template = customTemplate || DEFAULT_PROMPTS.edit;
  return template.replace(/\{instruction\}/g, instruction);
}

/** 提取花纹：收口函数，返回实际使用的完整 prompt；业务代码不直接拼字符串。 */
export function getTexturePrompt(
  type: 'pattern' | 'tileable' | 'pbr',
  mapType = '',
  customTemplates?: { pattern?: string; tileable?: string; pbr?: string }
): string {
  let t =
    customTemplates?.[type] ||
    (type === 'pattern' ? DEFAULT_PROMPTS.texture_pattern : type === 'tileable' ? DEFAULT_PROMPTS.texture_tileable : DEFAULT_PROMPTS.texture_pbr);
  if (type === 'pbr') t = t.replace(/\{mapType\}/g, mapType);
  return t;
}

/** 判断是否为可重试的 API 错误（限流、过载、服务内部错误等） */
function isRetryableError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err);
  return (
    msg.includes("503") ||
    msg.includes("overloaded") ||
    msg.includes("429") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("500") ||
    msg.includes("INTERNAL") ||
    msg.includes("Internal error")
  );
}

async function callWithRetry(apiFn, retries = 3, delay = 2000) {
  try {
    return await apiFn();
  } catch (err) {
    if (err != null && (err as { name?: string }).name === 'AbortError') throw err;
    if (isRetryableError(err) && retries > 0) {
      console.warn(`Gemini API 暂时异常，${delay}ms 后重试... (剩余 ${retries} 次)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callWithRetry(apiFn, retries - 1, delay * 2);
    }
    throw err;
  }
}

/** 将 API 返回的原始错误转为用户可读的简短说明（用于界面展示） */
export function normalizeApiErrorMessage(err: unknown): string {
  const raw = String((err as any)?.message ?? err);
  try {
    const parsed = JSON.parse(raw);
    const code = parsed?.error?.code ?? parsed?.code;
    const message = parsed?.error?.message ?? parsed?.message ?? raw;
    if (code === 500 || parsed?.error?.status === "INTERNAL") {
      return "服务暂时异常 (500)，请稍后重试";
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

/** 单图物体检测，返回边界框（归一化 0-1000） */
export async function detectObjectsInImage(base64Image: string, model = 'gemini-3-flash-preview', customPrompt?: string) {
  return callWithRetry(async () => {
    const ai = getAI();
    const prompt = customPrompt || DEFAULT_PROMPTS.detect_single;
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: base64Image.split(',')[1] || base64Image } }
        ]
      },
      config: {
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
      }
    });
    const results = JSON.parse(response.text || "[]");
    return results.map((r) => ({
      id: r.id,
      label: r.label,
      ymin: r.box_2d[0],
      xmin: r.box_2d[1],
      ymax: r.box_2d[2],
      xmax: r.box_2d[3]
    }));
  });
}

export async function processTexture(base64Image, type: 'pattern' | 'tileable' | 'pbr', mapType = '', model = 'gemini-2.5-flash-image', customPrompt?: string) {
  return callWithRetry(async () => {
    const ai = getAI();
    let prompt = customPrompt || '';
    
    if (type === 'pattern') prompt = prompt || DEFAULT_PROMPTS.texture_pattern;
    if (type === 'tileable') prompt = prompt || DEFAULT_PROMPTS.texture_tileable;
    if (type === 'pbr') prompt = (prompt || DEFAULT_PROMPTS.texture_pbr).replace('{mapType}', mapType);

    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image.split(',')[1] || base64Image } },
          { text: prompt }
        ]
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    throw new Error(`Texture processing (${type}) failed`);
  });
}

// ---------- 对话式生图模块 ----------

/**
 * 用文本模型理解用户对图片的修改需求，输出 JSON 格式生图指令。
 * @returns 解析后的对象，至少含 instruction 字符串；解析失败时返回 { instruction: rawText }
 */
export async function understandImageEditIntent(
  imageBase64: string | null,
  userPrompt: string,
  model = 'gemini-3-flash-preview',
  customPrompt?: string
): Promise<{ instruction: string; summary?: string; shouldGenerateImage?: boolean }> {
  const raw = await callWithRetry(async () => {
    const ai = getAI();
    const systemPrompt = customPrompt || DEFAULT_PROMPTS.dialog_understand;
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: `User request: ${userPrompt}\n\nOutput only a valid JSON object with "instruction" (required), optional "summary", and "shouldGenerateImage" (required, true only when user wants to edit/generate a new image):` }
    ];
    if (imageBase64) {
      const data = imageBase64.split(',')[1] || imageBase64;
      parts.unshift({ inlineData: { mimeType: 'image/jpeg', data } });
    }
    const response = await ai.models.generateContent({
      model,
      contents: { parts },
      config: { systemInstruction: systemPrompt }
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Empty understanding response');
    return text;
  });
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    const instruction = typeof obj.instruction === 'string' ? obj.instruction : raw;
    const shouldGenerateImage = obj.shouldGenerateImage === true;
    return { instruction, summary: obj.summary, shouldGenerateImage };
  } catch (_) {
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
  model = 'gemini-2.5-flash-image',
  options?: { aspectRatio?: string; imageSize?: string },
  customSystemPrompt?: string,
  abortSignal?: AbortSignal
): Promise<string> {
  return callWithRetry(async () => {
    const ai = getAI();
    const isTextToImage = !imageBase64;
    const systemInstruction = (customSystemPrompt || (isTextToImage ? DEFAULT_PROMPTS.dialog_text_to_image : DEFAULT_PROMPTS.edit)).replace('{instruction}', instruction);
    const config: { systemInstruction: string; imageConfig?: { aspectRatio?: string; imageSize?: string }; abortSignal?: AbortSignal } = {
      systemInstruction
    };
    if (options?.aspectRatio || options?.imageSize) {
      config.imageConfig = {};
      if (options.aspectRatio) config.imageConfig.aspectRatio = options.aspectRatio;
      if (options.imageSize) config.imageConfig.imageSize = options.imageSize;
    }
    if (abortSignal) config.abortSignal = abortSignal;
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = isTextToImage
      ? [{ text: instruction }]
      : [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64.split(',')[1] || imageBase64 } },
          { text: instruction }
        ];
    const response = await ai.models.generateContent({
      model,
      contents: { parts },
      config
    });
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    const textPart = response.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text);
    const hint = textPart?.text?.slice(0, 120) ? `（模型返回了文字: ${String(textPart.text).slice(0, 120)}…）` : '（当前模型可能不支持图像输出，请换用「快速」或「Pro」挡位）';
    throw new Error(`生图未返回图片${hint}`);
  });
}

/**
 * 根据用户首条描述（及可选图片）生成简短会话标题，优先以物体/主体命名。
 * @param imageBase64 可选；有图时结合画面内容命名（如「大门」「人物」）
 */
export async function generateSessionTitle(
  userText: string,
  model = 'gemini-3-flash-preview',
  customPrompt?: string,
  imageBase64?: string | null
): Promise<string> {
  const text = (userText || '').trim().slice(0, 200);
  if (!text && !imageBase64) return '';
  const prompt = (customPrompt || DEFAULT_PROMPTS.dialog_title) + (text ? '\n\n用户描述：' + text : '\n\n请根据图片内容命名。');
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];
  if (imageBase64) {
    const data = imageBase64.split(',')[1] || imageBase64;
    parts.unshift({ inlineData: { mimeType: 'image/jpeg', data } });
  }
  const raw = await callWithRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model,
      contents: { parts }
    });
    const out = response.text?.trim();
    if (!out) throw new Error('Empty title response');
    return out;
  });
  return (raw || '').replace(/["""'']/g, '').trim().slice(0, 8);
}

/** 纯文字对话：根据历史消息 + 新用户消息，返回助手文本回复 */
export async function getDialogTextResponse(
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> }>,
  model = 'gemini-3-flash-preview'
): Promise<string> {
  return callWithRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model,
      contents: contents.map((c) => ({
        role: c.role === 'model' ? 'model' : 'user',
        parts: c.parts
      }))
    });
    const text = response.text?.trim();
    if (text == null) throw new Error('Empty text response');
    return text;
  });
}

const SITE_ASSISTANT_SYSTEM = `You are the in-app assistant for AssetCutter AI Pro, a web app for intelligent asset production. You help users with:
- How to use features: 对话 (upload image + describe → AI generates image), 贴图 (pattern extract / seam repair / PBR texture generation), 生成3D (Tencent Hunyuan 3D, not yet launched), 仓库 (asset library), 工作流, 能力, 提示词效果 / 提示词擂台.
- Troubleshooting: e.g. "贴图修缝" needs Python backend or Pyodide; 对话/提取花纹/生成贴图 need GEMINI_API_KEY in .env.local.
- Other questions about the product. Reply in the same language as the user. Be concise and helpful.`;

/** 网站助手：根据用户提问 + 可选历史对话，返回助手回复（带系统角色） */
export async function getSiteAssistantResponse(
  userMessage: string,
  history: Array<{ role: 'user' | 'model'; text: string }> = [],
  model = 'gemini-3-flash-preview'
): Promise<string> {
  return callWithRetry(async () => {
    const ai = getAI();
    const contents = [
      ...history.map((m) => ({ role: m.role as 'user' | 'model', parts: [{ text: m.text }] as { text: string }[] })),
      { role: 'user' as const, parts: [{ text: (userMessage || '').trim() || '(empty)' }] }
    ];
    const response = await ai.models.generateContent({
      model,
      contents,
      config: { systemInstruction: SITE_ASSISTANT_SYSTEM }
    });
    const text = response.text?.trim();
    if (text == null) throw new Error('助手未返回内容');
    return text;
  });
}

/** 网站助手流式：每收到一段文本就调用 onChunk(当前完整文本)，返回最终完整文本 */
export async function getSiteAssistantResponseStream(
  userMessage: string,
  history: Array<{ role: 'user' | 'model'; text: string }>,
  onChunk: (fullText: string) => void,
  model = 'gemini-3-flash-preview'
): Promise<string> {
  const ai = getAI();
  const contents = [
    ...history.map((m) => ({ role: m.role as 'user' | 'model', parts: [{ text: m.text }] as { text: string }[] })),
    { role: 'user' as const, parts: [{ text: (userMessage || '').trim() || '(empty)' }] }
  ];
  const stream = await ai.models.generateContentStream({
    model,
    contents,
    config: { systemInstruction: SITE_ASSISTANT_SYSTEM }
  });
  let full = '';
  for await (const chunk of stream) {
    const t = chunk.text;
    if (t != null && typeof t === 'string') full += t;
    onChunk(full);
  }
  return full.trim();
}

/** 擂台 V2：根据自然语言描述生成两条生图用英文提示词 A/B，并返回推理过程。见 docs/PROMPT_OPTIMIZATION_AB_DESIGN.md §9 */
export async function generateArenaABPrompts(
  userDescription: string,
  model = 'gemini-3-flash-preview'
): Promise<{ reasoning?: string; promptA: string; promptB: string; rawResponse?: string }> {
  const raw = await callWithRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { text: DEFAULT_PROMPTS.arena_ab },
          { text: `User description: ${(userDescription || '').trim().slice(0, 500)}\n\nImportant: These prompts will be sent to the image model together with the user's uploaded image. Ensure each prompt is an instruction to modify or transform that image (not a standalone description of a new scene).` }
        ]
      },
      config: { responseMimeType: 'application/json' }
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Empty arena A/B response');
    return text;
  });
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
  model = 'gemini-3-flash-preview',
  allPreviousPrompts?: string[],
  userReportedGaps?: string[],
  winnerStrength?: string,
  loserRemark?: string
): Promise<{ reasoning?: string; prompt: string; rawResponse?: string }> {
  const raw = await callWithRetry(async () => {
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
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { text: DEFAULT_PROMPTS.arena_optimize_loser },
          { text: userText }
        ]
      },
      config: { responseMimeType: 'application/json' }
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Empty optimize loser response');
    return text;
  });
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
  model = 'gemini-3-flash-preview'
): Promise<{ reasoning?: string; prompts: string[]; rawResponse?: string }> {
  if (count === 2) {
    const out = await generateArenaABPrompts(userDescription, model);
    return { reasoning: out.reasoning, prompts: [out.promptA, out.promptB], rawResponse: out.rawResponse };
  }
  const raw = await callWithRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { text: DEFAULT_PROMPTS.arena_ab_n },
          { text: `User description: ${(userDescription || '').trim().slice(0, 500)}\n\nN = ${count}. Output exactly ${count} prompts (promptA, promptB${count >= 3 ? ', promptC' : ''}${count >= 4 ? ', promptD' : ''}). Important: These prompts will be sent to the image model together with the user's uploaded image; ensure each prompt is an instruction to modify or transform that image (not a standalone description of a new scene).` }
        ]
      },
      config: { responseMimeType: 'application/json' }
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Empty arena N response');
    return text;
  });
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
  model = 'gemini-3-flash-preview'
): Promise<{ reasoning?: string; prompt: string; rawResponse?: string }> {
  const raw = await callWithRetry(async () => {
    const ai = getAI();
    const userText = [
      `Original user intent: ${userIntent}`,
      `Current champion (winner) prompt: ${championPrompt}`,
      allPreviousPrompts.length > 0
        ? `All other prompts already in this arena (be distinct from these):\n${allPreviousPrompts.map((p, i) => `[${i + 1}] ${p}`).join('\n')}`
        : ''
    ].filter(Boolean).join('\n\n');
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { text: DEFAULT_PROMPTS.arena_new_challenger },
          { text: userText }
        ]
      },
      config: { responseMimeType: 'application/json' }
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Empty new challenger response');
    return text;
  });
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

/** 结构化复现：用 LLM 将生图提示词解析为主体/场景/风格/修饰。见 PROMPT_SCORING_DESIGN §6.1 */
export async function parsePromptStructured(
  prompt: string,
  model = 'gemini-3-flash-preview'
): Promise<{ subject: string; scene: string; style: string; modifiers: string }> {
  const raw = await callWithRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { text: DEFAULT_PROMPTS.parse_structured },
          { text: `Prompt to analyze:\n${(prompt || '').trim().slice(0, 3000)}` }
        ]
      },
      config: { responseMimeType: 'application/json' }
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Empty parse structured response');
    return text;
  });
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    return {
      subject: typeof obj.subject === 'string' ? obj.subject.trim() : '',
      scene: typeof obj.scene === 'string' ? obj.scene.trim() : '',
      style: typeof obj.style === 'string' ? obj.style.trim() : '',
      modifiers: typeof obj.modifiers === 'string' ? obj.modifiers.trim() : ''
    };
  } catch (e) {
    throw new Error('Failed to parse structured prompt: ' + String(e));
  }
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
  baseColorMap?: { base64: string }
): Promise<string> {
  const ai = getAI();
  const MODEL_NAME = 'gemini-2.5-flash-image';
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

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: { parts },
    config: {
      imageConfig: { aspectRatio: '1:1' }
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  throw new Error('No image data returned from AI');
}
