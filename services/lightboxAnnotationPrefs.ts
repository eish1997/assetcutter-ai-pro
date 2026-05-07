/**
 * 大图平面标注工具条用户偏好（按 `scopedStorageKey` 与账号隔离，经 clientPersist 写入 localStorage）。
 */
import { readLocalJson, writeLocalJson } from './clientPersist';

export type LightboxAnnotationLastLocalTool = 'local_edit_rect' | 'local_edit_ellipse' | 'local_edit_lasso';
export type LightboxAnnotationLastCropTool = 'crop_rect' | 'crop_lasso';

export type LightboxAnnotationUserPrefsV1 = {
  v: 1;
  lastLocalEditTool: LightboxAnnotationLastLocalTool;
  lastCropTool: LightboxAnnotationLastCropTool;
  overlayColor: string;
  brushWidth: number;
};

const DEFAULT: LightboxAnnotationUserPrefsV1 = {
  v: 1,
  lastLocalEditTool: 'local_edit_rect',
  lastCropTool: 'crop_rect',
  overlayColor: '#60a5fa',
  brushWidth: 3,
};

const LOCAL_TOOLS = new Set<string>(['local_edit_rect', 'local_edit_ellipse', 'local_edit_lasso']);
const CROP_TOOLS = new Set<string>(['crop_rect', 'crop_lasso']);

function normalize(parsed: unknown): LightboxAnnotationUserPrefsV1 | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  const lastLocalRaw = o.lastLocalEditTool;
  const lastCropRaw = o.lastCropTool;
  const lastLocalEditTool = LOCAL_TOOLS.has(String(lastLocalRaw))
    ? (String(lastLocalRaw) as LightboxAnnotationLastLocalTool)
    : DEFAULT.lastLocalEditTool;
  const lastCropTool = CROP_TOOLS.has(String(lastCropRaw))
    ? (String(lastCropRaw) as LightboxAnnotationLastCropTool)
    : DEFAULT.lastCropTool;
  let overlayColor = typeof o.overlayColor === 'string' ? o.overlayColor.trim() : DEFAULT.overlayColor;
  if (!/^#[0-9a-fA-F]{6}$/.test(overlayColor)) overlayColor = DEFAULT.overlayColor;
  let brushWidth = Number(o.brushWidth);
  if (!Number.isFinite(brushWidth)) brushWidth = DEFAULT.brushWidth;
  brushWidth = Math.max(1, Math.min(80, Math.round(brushWidth)));
  return {
    v: 1,
    lastLocalEditTool,
    lastCropTool,
    overlayColor,
    brushWidth,
  };
}

export function readLightboxAnnotationPrefs(storageKey: string): LightboxAnnotationUserPrefsV1 {
  return readLocalJson(storageKey, DEFAULT, normalize);
}

export function writeLightboxAnnotationPrefs(storageKey: string, prefs: LightboxAnnotationUserPrefsV1): void {
  writeLocalJson(storageKey, prefs);
}
