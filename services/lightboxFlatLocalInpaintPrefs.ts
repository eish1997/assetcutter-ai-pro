/**
 * 大图平面局部重绘贴回策略（按账号 `scopedStorageKey` 隔离，经 clientPersist）。
 */
import { readLocalString, scopedStorageKey, writeLocalString } from './clientPersist';

export type FlatLocalInpaintCompositeStrategy = 'fit_dest' | 'upscale_canvas' | 'detail_enhance';

const VALID: FlatLocalInpaintCompositeStrategy[] = ['fit_dest', 'upscale_canvas', 'detail_enhance'];

export function flatLocalInpaintCompositeStrategyKey(scope: string | null | undefined): string {
  return scopedStorageKey('workflow_flat_local_inpaint_composite', scope ?? null);
}

export function readFlatLocalInpaintCompositeStrategy(
  scope: string | null | undefined
): FlatLocalInpaintCompositeStrategy {
  const raw = readLocalString(flatLocalInpaintCompositeStrategyKey(scope))?.trim();
  if (raw && (VALID as string[]).includes(raw)) return raw as FlatLocalInpaintCompositeStrategy;
  return 'fit_dest';
}

export function writeFlatLocalInpaintCompositeStrategy(
  scope: string | null | undefined,
  strategy: FlatLocalInpaintCompositeStrategy
): void {
  writeLocalString(flatLocalInpaintCompositeStrategyKey(scope), strategy);
}

export const FLAT_LOCAL_INPAINT_COMPOSITE_LABELS: Record<
  FlatLocalInpaintCompositeStrategy,
  { title: string; hint: string }
> = {
  fit_dest: {
    title: '缩小贴回（默认）',
    hint: '将高分辨率生成图缩放到选区外扩矩形，贴回原图位置；底图尺寸不变。',
  },
  upscale_canvas: {
    title: '放大底图贴合',
    hint: '整体放大底图，使选区与生成图同像素尺寸后 1:1 贴合；输出分辨率会变大。',
  },
  detail_enhance: {
    title: '细节增强',
    hint: '适度放大底图并略缩小生成图后贴合，在选区内保留更多细节（输出可能变大）。',
  },
};
