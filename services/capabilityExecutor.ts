import type { CustomAppModule, DialogImageGear } from '../types';
import { DIALOG_IMAGE_GEARS } from '../types';
import { detectObjectsInImage, dialogGenerateImage } from './geminiService';

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
      const b = boxes[0];
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
        const prompt = (preset.instruction || '').trim();
        if (!prompt) return { ok: false, kind: 'none', error: '该能力为生图执行方式，但未填写提示词', durationMs: Date.now() - start };
        ctx.onLog?.('info', `[${actionLabel}] 按能力提示词生成中…`, undefined);
        const modelId = resolveImageModelId(preset.imageGear);
        const result = await dialogGenerateImage(cropped, prompt, modelId);
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

    const prompt = (preset.instruction || '').trim();
    if (!prompt) return { ok: false, kind: 'none', error: '该能力为生图执行方式，但未填写提示词', durationMs: Date.now() - start };
    ctx.onLog?.('info', `[${actionLabel}] 生图中…`, undefined);
    const modelId = resolveImageModelId(preset.imageGear);
    const result = await dialogGenerateImage(inputImageBase64, prompt, modelId);
    return { ok: true, kind: 'image', image: result, durationMs: Date.now() - start };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, kind: 'none', error: msg, durationMs: Date.now() - start };
  }
}

