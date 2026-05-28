/**
 * 能力单次测试：供能力模块「测试区域」调用，与工作流 runTask 逻辑一致。
 */
import type { CustomAppModule } from '../types';
import { executeCapability, type CapabilityExecuteContext } from './capabilityExecutor';
import {
  isCutImageCapabilityPreset,
  presetUsesHostBundleProcessor,
  readCutImageParams,
} from './capabilityProcessors/imageProcessProcessors';
import { detectCutImageBoxes, FULL_IMAGE_BOX } from './cutImageExecution';
import { cropBoxes } from './imageCrop';
import { DEFAULT_MODEL_TEXT } from './modelRegistry/constants';

export type CapabilityTestResult = {
  ok: boolean;
  resultImage?: string;
  /** 生视频（generate_video）测试结果 */
  resultVideoUrl?: string;
  /** 文字能力（gen_text）测试结果 */
  resultText?: string;
  error?: string;
  durationMs: number;
  /** 切割图片时返回裁剪张数 */
  cutCount?: number;
};

const CUT_IMAGE_TEST_TIMEOUT_MS = 10_000;

export async function runCapabilityTest(
  preset: CustomAppModule,
  imageBase64: string,
  opts?: { textModelRegistryId?: string }
): Promise<CapabilityTestResult> {
  const start = Date.now();
  const execCtx: CapabilityExecuteContext = {};
  const tm = (opts?.textModelRegistryId || '').trim();
  if (tm) execCtx.textModelRegistryId = tm;
  const visionTextModel = tm || DEFAULT_MODEL_TEXT;
  try {
    if (preset.category === 'generate_3d') {
      return { ok: false, error: '生成3D 请在工作流中拖图到能力框提交', durationMs: Date.now() - start };
    }
    if (presetUsesHostBundleProcessor(preset)) {
      const out = await executeCapability(preset, imageBase64 || '', execCtx);
      if (out.ok === false) return { ok: false, error: out.error, durationMs: out.durationMs };
      if (out.kind === 'text') {
        return { ok: true, resultImage: '', durationMs: out.durationMs, resultText: out.text };
      }
      if (out.kind === 'video') {
        return { ok: true, resultImage: '', durationMs: out.durationMs, resultVideoUrl: out.videoUrl };
      }
      return { ok: true, resultImage: out.image, durationMs: out.durationMs };
    }
    if (isCutImageCapabilityPreset(preset)) {
      const { cutOverflowPx } = readCutImageParams(preset);
      const { boxes } = await detectCutImageBoxes(imageBase64, preset, {
        visionTextModel,
        timeoutMs: CUT_IMAGE_TEST_TIMEOUT_MS,
      });
      const indexes = boxes.map((_, i) => i);
      const cropped = await cropBoxes(imageBase64, boxes, indexes, cutOverflowPx);
      return {
        ok: cropped.length > 0,
        resultImage: cropped[0],
        durationMs: Date.now() - start,
        cutCount: cropped.length,
      };
    }
    const out = await executeCapability(preset, imageBase64, execCtx);
    if (out.ok === false) return { ok: false, error: out.error, durationMs: out.durationMs };
    if (out.kind === 'text') {
      return { ok: true, resultImage: '', durationMs: out.durationMs, resultText: out.text };
    }
    if (out.kind === 'video') {
      return { ok: true, resultImage: '', durationMs: out.durationMs, resultVideoUrl: out.videoUrl };
    }
    return { ok: true, resultImage: out.image, durationMs: out.durationMs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, durationMs: Date.now() - start };
  }
}
