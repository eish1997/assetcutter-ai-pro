import type { CustomAppModule, DialogImageGear, CapabilitySet, CapabilitySetNode } from '../types';
import { DIALOG_IMAGE_GEARS } from '../types';
import { detectObjectsInImage, understandImageEditIntent, dialogGenerateImage, dialogGenerateImageMulti } from './geminiService';

export type CapabilityExecuteContext = {
  /** 用于日志输出（可选） */
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
};

export type CapabilityExecuteResult =
  | { ok: true; kind: 'image'; image: string; durationMs: number }
  | { ok: false; kind: 'none'; error: string; durationMs: number };

export function getCapabilityEngine(preset: CustomAppModule): 'gen_image' | 'builtin' {
  if (preset.engine) return preset.engine;
  if (preset.category === 'image_gen') return 'gen_image';
  return 'builtin';
}

export function resolveImageModelId(gear?: DialogImageGear): string {
  const g = gear || 'fast';
  return DIALOG_IMAGE_GEARS.find((x) => x.id === g)?.modelId || 'gemini-2.5-flash-image';
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
  ctx.onLog?.('info', `[${preset.label || preset.id}] 理解预设提示词中…`, undefined);
  const { instruction } = await understandImageEditIntent(
    inputImageBase64,
    presetPrompt,
    'gemini-3-flash-preview',
    undefined
  );
  const understood = (instruction || '').trim();
  return understood.length > 0 ? understood : null;
}

/**
 * 执行能力（单张图 -> 单张图）。切割图片等“多图输出/交互选择”的能力不在此处理。
 */
export async function executeCapability(
  preset: CustomAppModule,
  inputImageBase64: string,
  ctx: CapabilityExecuteContext = {}
): Promise<CapabilityExecuteResult> {
  const start = Date.now();
  try {
    if (preset.category === 'generate_3d') {
      return { ok: false, kind: 'none', error: '生成3D 请在工作流中拖图到能力框提交', durationMs: Date.now() - start };
    }

    const engine = getCapabilityEngine(preset);
    const actionLabel = preset.label || preset.id;

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
        const prompt = await resolveCapabilityPrompt(preset, cropped, ctx);
        if (!prompt) return { ok: false, kind: 'none', error: '该能力为生图执行方式，但未填写预设提示词或理解未返回有效指令', durationMs: Date.now() - start };
        ctx.onLog?.('info', `[${actionLabel}] 生图中…`, undefined);
        const modelId = resolveImageModelId(preset.imageGear);
        const imageOptions = (preset.imageAspectRatio || preset.imageSize) ? { aspectRatio: preset.imageAspectRatio, imageSize: preset.imageSize } : undefined;
        const result = await dialogGenerateImage(cropped, prompt, modelId, imageOptions);
        return { ok: true, kind: 'image', image: result || cropped, durationMs: Date.now() - start };
      }

      return { ok: true, kind: 'image', image: cropped, durationMs: Date.now() - start };
    }

    if (preset.id === 'cut_image') {
      return { ok: false, kind: 'none', error: '切割图片需要在工作流中执行（支持多图入组）', durationMs: Date.now() - start };
    }

    if (engine !== 'gen_image') {
      return { ok: false, kind: 'none', error: '该能力为图像处理执行方式，但没有内置实现', durationMs: Date.now() - start };
    }

    const prompt = await resolveCapabilityPrompt(preset, inputImageBase64, ctx);
    if (!prompt) return { ok: false, kind: 'none', error: '该能力为生图执行方式，但未填写预设提示词或理解未返回有效指令', durationMs: Date.now() - start };
    ctx.onLog?.('info', `[${actionLabel}] 生图中…`, undefined);
    const modelId = resolveImageModelId(preset.imageGear);
    const imageOptions = (preset.imageAspectRatio || preset.imageSize) ? { aspectRatio: preset.imageAspectRatio, imageSize: preset.imageSize } : undefined;
    const result = await dialogGenerateImage(inputImageBase64, prompt, modelId, imageOptions);
    return { ok: true, kind: 'image', image: result, durationMs: Date.now() - start };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, kind: 'none', error: msg, durationMs: Date.now() - start };
  }
}

export type CapabilitySetExecuteContext = CapabilityExecuteContext & {
  presets: CustomAppModule[];
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
          return node && (node.type === 'input' || node.type === 'preset');
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
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, kind: 'none', error: `[${n.data.label}] ${msg}`, durationMs: Date.now() - start };
          }
        } else {
          const srcId = sources.find((s) => outputs.has(s)) ?? sources[0];
          const srcImage = outputs.get(srcId) ?? inputImage;
          onLog?.('info', `[${set.label}] ${n.data.label} 执行中…`, undefined);
          const out = await executeCapability(preset, srcImage, { onLog });
          if (out.ok === false) {
            return { ok: false, kind: 'none', error: `[${n.data.label}] ${out.error}`, durationMs: Date.now() - start };
          }
          outputs.set(n.id, out.image);
          lastImage = out.image;
        }
      } else if (n.type === 'input') {
        outputs.set(n.id, inputImage);
        lastImage = inputImage;
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

  return { ok: true, kind: 'image', image: lastImage, durationMs: Date.now() - start };
}

