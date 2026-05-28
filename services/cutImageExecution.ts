import type { BoundingBox, CustomAppModule } from '../types';
import { readCutImageParams } from './capabilityProcessors/imageProcessProcessors';
import { detectGrid } from './gridDetector';
import { DEFAULT_PROMPTS, detectObjectsInImage } from './unifiedAiGateway';

export type CutImageDetectOptions = {
  visionTextModel: string;
  timeoutMs: number;
};

const FULL_IMAGE_BOX: BoundingBox = {
  id: 'full',
  label: '整图',
  xmin: 0,
  ymin: 0,
  xmax: 1000,
  ymax: 1000,
};

/** 按预设 params 检测切割区域；失败或空结果时返回整图框 */
export async function detectCutImageBoxes(
  inputImage: string,
  preset: CustomAppModule,
  options: CutImageDetectOptions
): Promise<BoundingBox[]> {
  const { cutMode, uniformRows, uniformCols } = readCutImageParams(preset);
  let boxes: BoundingBox[] = [];

  if (cutMode === 'uniform') {
    try {
      boxes = await detectGrid(inputImage, { mode: 'uniform', config: { rows: uniformRows, cols: uniformCols } });
    } catch {
      boxes = [];
    }
  } else if (cutMode === 'auto') {
    try {
      boxes = await Promise.race([
        detectGrid(inputImage, { mode: 'auto', config: {} }),
        new Promise<BoundingBox[]>((_, rej) =>
          setTimeout(() => rej(new Error('timeout')), options.timeoutMs)
        ),
      ]);
    } catch {
      boxes = [];
    }
  } else {
    try {
      boxes = await detectObjectsInImage(inputImage, options.visionTextModel, DEFAULT_PROMPTS.detect_blocks, {
        timeoutMs: options.timeoutMs,
      });
    } catch {
      boxes = [];
    }
  }

  return boxes.length ? boxes : [FULL_IMAGE_BOX];
}

export { FULL_IMAGE_BOX };
