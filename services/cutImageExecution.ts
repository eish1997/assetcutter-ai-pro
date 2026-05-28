import type { BoundingBox, CustomAppModule } from '../types';
import { readCutImageParams } from './capabilityProcessors/imageProcessProcessors';
import { detectGrid } from './gridDetector';
import { DEFAULT_PROMPTS, detectObjectsInImage } from './unifiedAiGateway';

export type CutImageDetectOptions = {
  visionTextModel: string;
  timeoutMs: number;
};

export type CutImageDetectResult = {
  boxes: BoundingBox[];
  /** 检测失败或为空时已回退整图，供工作流写 warn 日志 */
  warn?: string;
};

export const FULL_IMAGE_BOX: BoundingBox = {
  id: 'full',
  label: '整图',
  xmin: 0,
  ymin: 0,
  xmax: 1000,
  ymax: 1000,
};

/** 工作流在模块未就绪时的 cut_image 占位预设（参数走 readCutImageParams 默认值） */
export const FALLBACK_CUT_IMAGE_PRESET: CustomAppModule = {
  id: 'cut_image',
  label: '切割图片',
  category: 'image_process',
  processor: 'cut_image',
  engine: 'builtin',
  instruction: '',
};

function detectFailureMessage(cutMode: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (cutMode === 'uniform') return `均匀分割失败（${msg}），将整图作为一块裁剪`;
  if (cutMode === 'vision') return `区域识别超时或失败（${msg}），将整图作为一块裁剪`;
  return `自动检测超时或失败（${msg}），将整图作为一块裁剪`;
}

/** 按预设 params 检测切割区域；失败或空结果时返回整图框 */
export async function detectCutImageBoxes(
  inputImage: string,
  preset: CustomAppModule,
  options: CutImageDetectOptions
): Promise<CutImageDetectResult> {
  const { cutMode, uniformRows, uniformCols } = readCutImageParams(preset);
  let boxes: BoundingBox[] = [];
  let warn: string | undefined;

  if (cutMode === 'uniform') {
    try {
      boxes = await detectGrid(inputImage, { mode: 'uniform', config: { rows: uniformRows, cols: uniformCols } });
    } catch (e) {
      warn = detectFailureMessage(cutMode, e);
    }
  } else if (cutMode === 'auto') {
    try {
      boxes = await Promise.race([
        detectGrid(inputImage, { mode: 'auto', config: {} }),
        new Promise<BoundingBox[]>((_, rej) =>
          setTimeout(() => rej(new Error('timeout')), options.timeoutMs)
        ),
      ]);
    } catch (e) {
      warn = detectFailureMessage(cutMode, e);
    }
  } else {
    try {
      boxes = await detectObjectsInImage(inputImage, options.visionTextModel, DEFAULT_PROMPTS.detect_blocks, {
        timeoutMs: options.timeoutMs,
      });
    } catch (e) {
      warn = detectFailureMessage(cutMode, e);
    }
  }

  if (!boxes.length) {
    return { boxes: [FULL_IMAGE_BOX], warn };
  }
  return { boxes, warn };
}
