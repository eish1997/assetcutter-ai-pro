import type { CustomAppModule, DialogImageGear, CapabilitySet, CapabilitySetNode } from '../types';
import { DIALOG_IMAGE_GEARS } from '../types';
import type { VgpGenStepCapture } from '../types/vgp';
import {
  detectObjectsInImage,
  understandImageEditIntent,
  dialogGenerateImage,
  dialogGenerateImageMulti,
  getDialogTextResponse,
  CAPABILITY_UNDERSTAND_RETRY_OPTIONS,
  normalizeApiErrorMessage,
} from './geminiService';

export type CapabilityExecuteContext = {
  /** 用于日志输出（可选） */
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  /**
   * 阶段 B：默认 `legacy`（先理解预设提示词再生图）。
   * `compiler` 为规则编译器直出英文指令，不调用「理解」LLM。
   */
  promptResolution?: 'legacy' | 'compiler';
  /** 编译器输入：目标摘要、维度约束等 */
  semanticForCompiler?: {
    targetSummary?: string;
    dimensions?: Record<string, string | undefined>;
  };
};

export type CapabilityExecuteResult =
  | { ok: true; kind: 'image'; image: string; durationMs: number; vgpSteps?: VgpGenStepCapture[] }
  | { ok: true; kind: 'text'; text: string; durationMs: number }
  | { ok: false; kind: 'none'; error: string; durationMs: number };

function parseInlineForLlm(input: string): { mimeType: string; data: string } {
  const raw = (input || '').trim();
  const matched = raw.match(/^data:([^;,]+);base64,(.+)$/i);
  if (matched) {
    return { mimeType: matched[1] || 'image/jpeg', data: matched[2] || '' };
  }
  return { mimeType: 'image/jpeg', data: raw };
}

function hasUsableImageBase64(input: string): boolean {
  const p = parseInlineForLlm(input);
  return p.data.length > 8;
}

function makeVgpCapture(
  preset: CustomAppModule,
  understoodPrompt: string,
  modelId: string,
  stepKeyOverride?: string
): VgpGenStepCapture {
  return {
    stepKey: stepKeyOverride ?? preset.id,
    understoodPrompt,
    presetId: preset.id,
    presetLabel: preset.label || preset.id,
    modelId,
    gear: preset.imageGear,
    aspectRatio: preset.imageAspectRatio,
    imageSize: preset.imageSize,
  };
}

export function getCapabilityEngine(preset: CustomAppModule): 'gen_image' | 'gen_text' | 'builtin' {
  if (preset.engine) return preset.engine;
  const cat = preset.category;
  if (cat === 'text_to_text' || cat === 'image_to_text') return 'gen_text';
  if (cat === 'text_to_image') return 'gen_image';
  if (cat === 'image_to_image') {
    if (preset.id === 'split_component' || preset.id === 'cut_image') return 'builtin';
    return 'gen_image';
  }
  if (cat === 'generate_3d') return 'builtin';
  if (cat === 'image_gen' || (cat as string) === 'image_gen') return 'gen_image';
  if (cat === 'text_llm' || (cat as string) === 'text_llm') return 'gen_text';
  if (cat === 'image_process' || (cat as string) === 'image_process') return 'builtin';
  return 'builtin';
}

/** 工作流侧栏「词」微调列：走生图模型时展示 */
export function capabilityUsesGenImageEngine(preset: CustomAppModule): boolean {
  return getCapabilityEngine(preset) === 'gen_image';
}

export function resolveImageModelId(gear?: DialogImageGear): string {
  const g = gear || 'standard';
  return DIALOG_IMAGE_GEARS.find((x) => x.id === g)?.modelId || 'gemini-3.1-flash-image-preview';
}

/**
 * 工作流生图：先将预设提示词交给文字模型理解（与对话模式一致），再拿理解结果调用生图模型。
 */
async function resolveCapabilityPrompt(
  preset: CustomAppModule,
  inputImageBase64: string,
  ctx: CapabilityExecuteContext
): Promise<string | null> {
  const presetPrompt = (preset.instruction || '').trim();
  if (!presetPrompt) return null;
  if (preset.skipUnderstand === true) {
    ctx.onLog?.('info', `[${preset.label || preset.id}] 未启用理解，提示词直发生图`, undefined);
    return presetPrompt;
  }
  ctx.onLog?.('info', `[${preset.label || preset.id}] 理解预设提示词中…`, undefined);
  const { instruction } = await understandImageEditIntent(
    inputImageBase64,
    presetPrompt,
    'gemini-3-flash-preview',
    undefined,
    CAPABILITY_UNDERSTAND_RETRY_OPTIONS
  );
  const understood = (instruction || '').trim();
  return understood.length > 0 ? understood : null;
}

async function resolveGenImagePrompt(
  preset: CustomAppModule,
  inputImageBase64: string,
  ctx: CapabilityExecuteContext
): Promise<string | null> {
  if (preset.skipUnderstand === true) {
    const directPrompt = (preset.instruction || '').trim();
    return directPrompt || null;
  }
  if (ctx.promptResolution === 'compiler') {
    const { compilePromptForCapability } = await import('./compiler/compilePrompt');
    const out = compilePromptForCapability({
      preset,
      targetSummary: ctx.semanticForCompiler?.targetSummary,
      dimensions: ctx.semanticForCompiler?.dimensions,
    });
    if (out.compiled_prompt.trim()) {
      ctx.onLog?.(
        'info',
        `[${preset.label || preset.id}] 使用规则编译器生成指令（${out.compiler_version}）`,
        undefined
      );
      return out.compiled_prompt;
    }
  }
  return resolveCapabilityPrompt(preset, inputImageBase64, ctx);
}

async function resolveTextOnlyImagePrompt(
  preset: CustomAppModule,
  userText: string,
  ctx: CapabilityExecuteContext
): Promise<string | null> {
  const presetPrompt = (preset.instruction || '').trim();
  const ut = (userText || '').trim();
  if (preset.skipUnderstand === true) {
    const merged = [presetPrompt, ut].filter(Boolean).join('\n\n').trim();
    return merged || null;
  }
  ctx.onLog?.('info', `[${preset.label || preset.id}] 整理文生图提示词中…`, undefined);
  const fused = await getDialogTextResponse(
    [
      {
        role: 'user',
        parts: [
          {
            text: `你是生图提示词助手。将「预设」与「用户文字」融合为一段可直接用于文生图的简洁画面描述（中文或英文均可，只输出描述正文）。\n\n【预设】\n${presetPrompt || '(无)'}\n\n【用户文字】\n${ut || '(无)'}`,
          },
        ],
      },
    ],
    'gemini-3-flash-preview'
  );
  const out = (fused || '').trim();
  return out.length > 0 ? out : null;
}

async function executeGenTextPath(
  preset: CustomAppModule,
  inputImageBase64: string,
  inputText: string | undefined,
  ctx: CapabilityExecuteContext
): Promise<CapabilityExecuteResult> {
  const start = Date.now();
  const actionLabel = preset.label || preset.id;
  const sys = (preset.instruction || '').trim() || '请根据用户输入完成任务，直接输出结果正文。';
  const userT = (inputText || '').trim();
  const hasImg = hasUsableImageBase64(inputImageBase64);
  if (preset.category === 'text_to_text') {
    if (hasImg) {
      return {
        ok: false,
        kind: 'none',
        error: '文生文能力请拖入文字卡（不要拖图片）',
        durationMs: Date.now() - start,
      };
    }
    if (!userT) {
      return {
        ok: false,
        kind: 'none',
        error: '文生文需要文字卡片内容',
        durationMs: Date.now() - start,
      };
    }
  }
  if (preset.category === 'image_to_text' && !hasImg) {
    return {
      ok: false,
      kind: 'none',
      error: '图生文需要图片',
      durationMs: Date.now() - start,
    };
  }
  if (!hasImg && !userT) {
    return {
      ok: false,
      kind: 'none',
      error: '需要文字卡片内容或图片',
      durationMs: Date.now() - start,
    };
  }
  ctx.onLog?.('info', `[${actionLabel}] 文字模型处理中…`, undefined);
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  if (hasImg) {
    parts.push({ inlineData: parseInlineForLlm(inputImageBase64) });
  }
  const body = [
    `【系统任务】\n${sys}`,
    userT && `【用户文字】\n${userT}`,
    hasImg && '【附图】请结合图片完成上述任务。',
  ]
    .filter(Boolean)
    .join('\n\n');
  parts.push({ text: body });
  try {
    const text = await getDialogTextResponse([{ role: 'user', parts }], 'gemini-3-flash-preview');
    const out = (text || '').trim();
    if (!out) return { ok: false, kind: 'none', error: '文字模型未返回内容', durationMs: Date.now() - start };
    return { ok: true, kind: 'text', text: out, durationMs: Date.now() - start };
  } catch (e) {
    const msg = normalizeApiErrorMessage(e);
    return { ok: false, kind: 'none', error: msg, durationMs: Date.now() - start };
  }
}

export type ExecuteCapabilityOptions = {
  /** 来自文字资产卡片的正文 */
  inputText?: string;
};

/**
 * 执行能力：生图 / 文字 / 内置图像处理。切割图片等“多图输出/交互选择”的能力不在此处理。
 */
export async function executeCapability(
  preset: CustomAppModule,
  inputImageBase64: string,
  ctx: CapabilityExecuteContext = {},
  opts?: ExecuteCapabilityOptions
): Promise<CapabilityExecuteResult> {
  const start = Date.now();
  const inputText = opts?.inputText;
  try {
    if (preset.category === 'generate_3d') {
      return { ok: false, kind: 'none', error: '生成3D 请在工作流中拖图到能力框提交', durationMs: Date.now() - start };
    }

    const engine = getCapabilityEngine(preset);
    const actionLabel = preset.label || preset.id;

    if (engine === 'gen_text') {
      return executeGenTextPath(preset, inputImageBase64, inputText, ctx);
    }

    // 内置：拆分组件（输出“首个区域裁剪图”，可选再走生图）
    if (preset.id === 'split_component') {
      ctx.onLog?.('info', `[${actionLabel}] 识别物体中…`, undefined);
      const boxes = await detectObjectsInImage(inputImageBase64);
      if (!boxes.length) {
        return { ok: false, kind: 'none', error: '未识别到区域', durationMs: Date.now() - start };
      }
      const b = boxes.reduce((best, current) => {
        const bestArea = Math.max(0, best.xmax - best.xmin) * Math.max(0, best.ymax - best.ymin);
        const currentArea = Math.max(0, current.xmax - current.xmin) * Math.max(0, current.ymax - current.ymin);
        return currentArea > bestArea ? current : best;
      });
      const img = new Image();
      img.src = inputImageBase64;
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = rej;
      });
      const scaleX = img.naturalWidth / 1000;
      const scaleY = img.naturalHeight / 1000;
      const x = Math.max(0, b.xmin * scaleX);
      const y = Math.max(0, b.ymin * scaleY);
      const w = Math.min(img.naturalWidth - x, (b.xmax - b.xmin) * scaleX);
      const h = Math.min(img.naturalHeight - y, (b.ymax - b.ymin) * scaleY);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const c2d = canvas.getContext('2d')!;
      c2d.drawImage(img, x, y, w, h, 0, 0, w, h);
      const cropped = canvas.toDataURL('image/png');

      if (engine === 'gen_image') {
        const prompt = await resolveGenImagePrompt(preset, cropped, ctx);
        if (!prompt) return { ok: false, kind: 'none', error: '该能力为生图执行方式，但未填写预设提示词或理解未返回有效指令', durationMs: Date.now() - start };
        ctx.onLog?.('info', `[${actionLabel}] 生图中…`, undefined);
        const modelId = resolveImageModelId(preset.imageGear);
        const imageOptions = (preset.imageAspectRatio || preset.imageSize) ? { aspectRatio: preset.imageAspectRatio, imageSize: preset.imageSize } : undefined;
        const result = await dialogGenerateImage(cropped, prompt, modelId, imageOptions);
        return {
          ok: true,
          kind: 'image',
          image: result || cropped,
          durationMs: Date.now() - start,
          vgpSteps: [makeVgpCapture(preset, prompt, modelId)],
        };
      }

      return { ok: true, kind: 'image', image: cropped, durationMs: Date.now() - start };
    }

    if (preset.id === 'cut_image') {
      return { ok: false, kind: 'none', error: '切割图片需要在工作流中执行（支持多图入组）', durationMs: Date.now() - start };
    }

    if (engine !== 'gen_image') {
      return { ok: false, kind: 'none', error: '该能力为图像处理执行方式，但没有内置实现', durationMs: Date.now() - start };
    }

    const hasImg = hasUsableImageBase64(inputImageBase64);
    const userT = (inputText || '').trim();

    if (preset.category === 'text_to_image' && hasImg) {
      return {
        ok: false,
        kind: 'none',
        error: '文生图能力请拖入文字卡，不要拖图片',
        durationMs: Date.now() - start,
      };
    }

    if (!hasImg) {
      if (preset.category === 'image_to_image') {
        return {
          ok: false,
          kind: 'none',
          error: '图生图需要图片（请拖入图片卡）',
          durationMs: Date.now() - start,
        };
      }
      const prompt = await resolveTextOnlyImagePrompt(preset, userT, ctx);
      if (!prompt) {
        return {
          ok: false,
          kind: 'none',
          error: '文生图需要预设提示词，或勾选「理解」并提供文字卡片内容',
          durationMs: Date.now() - start,
        };
      }
      ctx.onLog?.('info', `[${actionLabel}] 文生图中…`, undefined);
      const modelId = resolveImageModelId(preset.imageGear);
      const imageOptions =
        preset.imageAspectRatio || preset.imageSize
          ? { aspectRatio: preset.imageAspectRatio, imageSize: preset.imageSize }
          : undefined;
      const result = await dialogGenerateImage(null, prompt, modelId, imageOptions);
      return {
        ok: true,
        kind: 'image',
        image: result,
        durationMs: Date.now() - start,
        vgpSteps: [makeVgpCapture(preset, prompt, modelId)],
      };
    }

    const prompt = await resolveGenImagePrompt(preset, inputImageBase64, ctx);
    if (!prompt) return { ok: false, kind: 'none', error: '该能力为生图执行方式，但未填写预设提示词或理解未返回有效指令', durationMs: Date.now() - start };
    const augmented =
      userT && (preset.category === 'image_to_image' || (preset.category as string) === 'image_gen' || (preset.category as string) === 'text_llm')
        ? `${prompt}\n\n【用户补充文字】\n${userT}`
        : prompt;
    ctx.onLog?.('info', `[${actionLabel}] 生图中…`, undefined);
    const modelId = resolveImageModelId(preset.imageGear);
    const imageOptions = (preset.imageAspectRatio || preset.imageSize) ? { aspectRatio: preset.imageAspectRatio, imageSize: preset.imageSize } : undefined;
    const result = await dialogGenerateImage(inputImageBase64, augmented, modelId, imageOptions);
    return {
      ok: true,
      kind: 'image',
      image: result,
      durationMs: Date.now() - start,
      vgpSteps: [makeVgpCapture(preset, augmented, modelId)],
    };
  } catch (e) {
    const msg = normalizeApiErrorMessage(e);
    return { ok: false, kind: 'none', error: msg, durationMs: Date.now() - start };
  }
}

export type CapabilitySetExecuteContext = CapabilityExecuteContext & {
  presets: CustomAppModule[];
  /**
   * 资产输入节点可用的图片映射（key=nodeId）。
   * 主要用于画布内运行测试时，从工作区/仓库选中的资产喂给流程。
   */
  assetInputs?: Record<string, string | undefined>;
  /**
   * 若设置：执行到该测试断点节点并完成其透传后**立即返回**（不跑下游），用于画布「运行测试」。
   */
  stopAtNodeId?: string;
};

export function validateCapabilitySetGraph(set: CapabilitySet, presets: CustomAppModule[]): string | null {
  const inputNodes = set.nodes.filter((n) => n.type === 'input');
  const outputNodes = set.nodes.filter((n) => n.type === 'output');
  if (inputNodes.length !== 1) return '能力集合必须且只能有 1 个输入节点';
  if (outputNodes.length < 1) return '能力集合至少需要 1 个输出节点';

  for (const node of set.nodes) {
    if (node.type !== 'preset') continue;
    if (!node.data.presetId) return `节点「${node.data.label || node.id}」缺少预设绑定`;
    if (!presets.some((preset) => preset.id === node.data.presetId)) {
      return `节点「${node.data.label || node.id}」引用了不存在的预设`;
    }
  }

  const inByTarget = new Map<string, number>();
  const outBySource = new Map<string, number>();
  for (const e of set.edges) {
    inByTarget.set(e.target, (inByTarget.get(e.target) ?? 0) + 1);
    outBySource.set(e.source, (outBySource.get(e.source) ?? 0) + 1);
  }
  for (const n of set.nodes) {
    if (n.type !== 'testStop') continue;
    const inc = inByTarget.get(n.id) ?? 0;
    const outc = outBySource.get(n.id) ?? 0;
    if (inc < 1 || outc < 1) {
      return `测试断点「${n.data.label || n.id}」需至少一条入边与一条出边`;
    }
  }

  return null;
}

/**
 * 执行能力集合：按图的拓扑顺序执行。支持多分支汇聚到生图模型（线稿+色块+文本生成 -> 生图模型）。
 */
export async function executeCapabilitySet(
  set: CapabilitySet,
  inputImage: string,
  ctx: CapabilitySetExecuteContext
): Promise<CapabilityExecuteResult> {
  const start = Date.now();
  const { presets, onLog } = ctx;
  const setVgpSteps: VgpGenStepCapture[] = [];
  const validationError = validateCapabilitySetGraph(set, presets);
  if (validationError) {
    return { ok: false, kind: 'none', error: validationError, durationMs: Date.now() - start };
  }
  const nodeMap = new Map<string, CapabilitySetNode>(set.nodes.map((n) => [n.id, n]));
  const inEdges = new Map<string, string[]>();
  for (const e of set.edges) {
    if (!inEdges.has(e.target)) inEdges.set(e.target, []);
    inEdges.get(e.target)!.push(e.source);
  }
  const outputs = new Map<string, string>();
  const inputNode = set.nodes.find((n) => n.type === 'input');
  if (inputNode) outputs.set(inputNode.id, inputImage);

  const done = new Set<string>(inputNode ? [inputNode.id] : []);
  let lastImage: string = inputImage;

  while (done.size < set.nodes.length) {
    let progressed = false;
    for (const n of set.nodes) {
      if (done.has(n.id)) continue;
      const sources = inEdges.get(n.id) ?? [];
      if (sources.some((s) => !done.has(s))) continue;

      if (n.type === 'preset' && n.data.presetId) {
        const preset = presets.find((p) => p.id === n.data.presetId);
        if (!preset) {
          onLog?.('warn', `[能力集合] 未找到预设 ${n.data.presetId}，跳过节点 ${n.data.label}`);
          done.add(n.id);
          progressed = true;
          continue;
        }
        const imageSourceIds = sources.filter((s) => {
          const node = nodeMap.get(s);
          return node && (node.type === 'input' || node.type === 'preset' || node.type === 'assetInput');
        });
        const textGenSourceId = sources.find((s) => nodeMap.get(s)?.type === 'textGen');
        const imagesFromSources = imageSourceIds.map((id) => outputs.get(id)).filter(Boolean) as string[];
        const promptFromTextGen = textGenSourceId ? (nodeMap.get(textGenSourceId)?.data?.text ?? '').trim() : '';

        const isMultiInput = imagesFromSources.length > 1 || (imagesFromSources.length >= 1 && promptFromTextGen.length > 0);

        if (isMultiInput && getCapabilityEngine(preset) === 'gen_image') {
          const images = imagesFromSources.length > 0 ? imagesFromSources : [inputImage];
          const instruction = promptFromTextGen || (preset.instruction ?? '').trim() || '根据以上参考图生成最终效果。';
          onLog?.('info', `[${set.label}] ${n.data.label} 执行中（${images.length} 张图 + 提示词）…`, undefined);
          const modelId = resolveImageModelId(preset.imageGear);
          const imageOptions = (preset.imageAspectRatio || preset.imageSize) ? { aspectRatio: preset.imageAspectRatio, imageSize: preset.imageSize } : undefined;
          try {
            const result = await dialogGenerateImageMulti(images, instruction, modelId, imageOptions);
            outputs.set(n.id, result);
            lastImage = result;
            setVgpSteps.push(
              makeVgpCapture(preset, instruction, modelId, `set-node:${n.id}`)
            );
          } catch (e) {
            const msg = normalizeApiErrorMessage(e);
            return { ok: false, kind: 'none', error: `[${n.data.label}] ${msg}`, durationMs: Date.now() - start };
          }
        } else {
          const srcId = sources.find((s) => outputs.has(s)) ?? sources[0];
          const srcImage = outputs.get(srcId) ?? inputImage;
          onLog?.('info', `[${set.label}] ${n.data.label} 执行中…`, undefined);
          const out = await executeCapability(preset, srcImage, ctx);
          if (out.ok === false) {
            return { ok: false, kind: 'none', error: `[${n.data.label}] ${out.error}`, durationMs: Date.now() - start };
          }
          if (out.kind !== 'image') {
            return {
              ok: false,
              kind: 'none',
              error: `[${n.data.label}] 能力集合暂不支持该节点的纯文字输出，请在工作流单预设中执行`,
              durationMs: Date.now() - start,
            };
          }
          outputs.set(n.id, out.image);
          lastImage = out.image;
          if (out.vgpSteps?.length) {
            for (const s of out.vgpSteps) {
              setVgpSteps.push({ ...s, stepKey: `set-node:${n.id}` });
            }
          }
        }
      } else if (n.type === 'input') {
        outputs.set(n.id, inputImage);
        lastImage = inputImage;
      } else if (n.type === 'assetInput') {
        const fromMap = ctx.assetInputs?.[n.id];
        const img = (fromMap ?? '').trim() || inputImage;
        outputs.set(n.id, img);
        lastImage = img;
      } else if (n.type === 'output') {
        if (!sources.length) {
          return { ok: false, kind: 'none', error: `输出节点「${n.data.label || n.id}」缺少输入`, durationMs: Date.now() - start };
        }
        const srcId = sources.find((s) => outputs.has(s));
        if (!srcId) {
          return {
            ok: false,
            kind: 'none',
            error: `输出节点「${n.data.label || n.id}」未收到有效图像输入`,
            durationMs: Date.now() - start,
          };
        }
        const outputImage = outputs.get(srcId);
        if (!outputImage) {
          return {
            ok: false,
            kind: 'none',
            error: `输出节点「${n.data.label || n.id}」未收到有效图像输入`,
            durationMs: Date.now() - start,
          };
        }
        lastImage = outputImage;
        outputs.set(n.id, outputImage);
      } else if (n.type === 'textGen') {
        done.add(n.id);
        progressed = true;
        continue;
      } else if (n.type === 'testStop') {
        const srcId = sources.find((s) => outputs.has(s)) ?? sources[0];
        const img = (srcId ? outputs.get(srcId) : undefined) ?? inputImage;
        outputs.set(n.id, img);
        lastImage = img;
        done.add(n.id);
        progressed = true;
        if (ctx.stopAtNodeId === n.id) {
          return {
            ok: true,
            kind: 'image',
            image: img,
            durationMs: Date.now() - start,
            vgpSteps: setVgpSteps.length ? setVgpSteps : undefined,
          };
        }
        continue;
      }
      done.add(n.id);
      progressed = true;
    }
    if (!progressed) {
      const blocked = set.nodes
        .filter((n) => !done.has(n.id))
        .map((n) => n.data.label || n.id)
        .join('、');
      return {
        ok: false,
        kind: 'none',
        error: `能力集合无法继续执行，可能存在环路或缺少上游输入：${blocked}`,
        durationMs: Date.now() - start,
      };
    }
  }

  return {
    ok: true,
    kind: 'image',
    image: lastImage,
    durationMs: Date.now() - start,
    vgpSteps: setVgpSteps.length ? setVgpSteps : undefined,
  };
}

