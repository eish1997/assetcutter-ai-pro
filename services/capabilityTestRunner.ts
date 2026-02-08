/**
 * 能力单次测试：供能力模块「测试区域」调用，与工作流 runTask 逻辑一致。
 */
import type { CustomAppModule, BoundingBox } from '../types';
import { detectObjectsInImage, dialogGenerateImage, DEFAULT_PROMPTS } from './geminiService';

function cropOneBox(inputImage: string, b: BoundingBox): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = inputImage;
    img.onload = () => {
      const scaleX = img.naturalWidth / 1000;
      const scaleY = img.naturalHeight / 1000;
      const x = Math.max(0, b.xmin * scaleX);
      const y = Math.max(0, b.ymin * scaleY);
      const w = Math.min(img.naturalWidth - x, (b.xmax - b.xmin) * scaleX);
      const h = Math.min(img.naturalHeight - y, (b.ymax - b.ymin) * scaleY);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('图片加载失败'));
  });
}

function cropBoxes(inputImage: string, boxes: BoundingBox[], indexes: number[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = inputImage;
    img.onload = () => {
      const scaleX = img.naturalWidth / 1000;
      const scaleY = img.naturalHeight / 1000;
      const results: string[] = [];
      for (const i of indexes) {
        if (i < 0 || i >= boxes.length) continue;
        const b = boxes[i];
        const x = Math.max(0, b.xmin * scaleX);
        const y = Math.max(0, b.ymin * scaleY);
        const w = Math.min(img.naturalWidth - x, (b.xmax - b.xmin) * scaleX);
        const h = Math.min(img.naturalHeight - y, (b.ymax - b.ymin) * scaleY);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        results.push(canvas.toDataURL('image/png'));
      }
      resolve(results);
    };
    img.onerror = () => reject(new Error('图片加载失败'));
  });
}

export type CapabilityTestResult = {
  ok: boolean;
  resultImage?: string;
  error?: string;
  durationMs: number;
  /** 切割图片时返回裁剪张数 */
  cutCount?: number;
};

export async function runCapabilityTest(
  preset: CustomAppModule,
  imageBase64: string
): Promise<CapabilityTestResult> {
  const start = Date.now();
  try {
    if (preset.category === 'generate_3d') {
      return { ok: false, error: '生成3D 请在工作流中拖图到能力框提交', durationMs: Date.now() - start };
    }
    if (preset.id === 'split_component') {
      const boxes = await detectObjectsInImage(imageBase64);
      if (boxes.length === 0)
        return { ok: false, error: '未识别到区域', durationMs: Date.now() - start };
      const cropped = await cropOneBox(imageBase64, boxes[0]);
      if (preset.instruction?.trim()) {
        const result = await dialogGenerateImage(cropped, preset.instruction.trim(), 'gemini-2.5-flash-image');
        return { ok: !!result, resultImage: result ?? cropped, durationMs: Date.now() - start };
      }
      return { ok: true, resultImage: cropped, durationMs: Date.now() - start };
    }
    if (preset.id === 'cut_image') {
      const boxes = await Promise.race([
        detectObjectsInImage(imageBase64, 'gemini-3-flash-preview', DEFAULT_PROMPTS.detect_blocks),
        new Promise<BoundingBox[]>((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
      ]).catch(() => [] as BoundingBox[]);
      const list = boxes.length ? boxes : [{ id: 'full', label: '整图', ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 }];
      const cropped = await cropBoxes(imageBase64, list, list.map((_, i) => i));
      return {
        ok: cropped.length > 0,
        resultImage: cropped[0],
        durationMs: Date.now() - start,
        cutCount: cropped.length,
      };
    }
    const prompt = preset.instruction?.trim() || 'Apply the requested transformation to this image.';
    const result = await dialogGenerateImage(imageBase64, prompt, 'gemini-2.5-flash-image');
    return { ok: !!result, resultImage: result ?? undefined, durationMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, durationMs: Date.now() - start };
  }
}
