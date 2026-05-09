/**
 * 大图全景局部重绘贴回偏好（按账号 `scopedStorageKey` 隔离，经 clientPersist）。
 */
import { readLocalFlag, scopedStorageKey, writeLocalFlag } from './clientPersist';

export function panoLocalInpaintShrinkToBaseKey(scope: string | null | undefined): string {
  return scopedStorageKey('workflow_pano_local_inpaint_shrink_to_base', scope ?? null);
}

/** 开启：高分辨率贴回后再高质量缩小到原底图尺寸；关闭：输出可与底图不同（通常更大、更细）。 */
export function readPanoLocalInpaintShrinkToBase(scope: string | null | undefined): boolean {
  return readLocalFlag(panoLocalInpaintShrinkToBaseKey(scope));
}

export function writePanoLocalInpaintShrinkToBase(scope: string | null | undefined, on: boolean): void {
  writeLocalFlag(panoLocalInpaintShrinkToBaseKey(scope), on);
}
