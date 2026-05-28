/**
 * 大图局部重绘扩边像素偏好（按账号 `scopedStorageKey` 隔离，经 clientPersist）。
 */
import { readLocalString, scopedStorageKey, writeLocalString } from './clientPersist';

/** `auto` = 按选区 18% 外扩（至少 16px）；数字 = 四边固定像素 */
export type LocalInpaintExpandMode = 'auto' | number;

export const LOCAL_INPAINT_EXPAND_PRESETS: Array<{ mode: LocalInpaintExpandMode; label: string }> = [
  { mode: 'auto', label: '自动' },
  { mode: 0, label: '0' },
  { mode: 16, label: '16' },
  { mode: 32, label: '32' },
  { mode: 64, label: '64' },
  { mode: 128, label: '128' },
  { mode: 256, label: '256' },
];

export function localInpaintExpandModeKey(scope: string | null | undefined): string {
  return scopedStorageKey('workflow_local_inpaint_expand_mode', scope ?? null);
}

function normalizeLocalInpaintExpandMode(raw: string | null | undefined): LocalInpaintExpandMode {
  const t = raw?.trim();
  if (!t || t === 'auto') return 'auto';
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return 'auto';
  const preset = LOCAL_INPAINT_EXPAND_PRESETS.find((p) => p.mode !== 'auto' && p.mode === Math.round(n));
  return preset ? (preset.mode as number) : 'auto';
}

export function readLocalInpaintExpandMode(scope: string | null | undefined): LocalInpaintExpandMode {
  return normalizeLocalInpaintExpandMode(readLocalString(localInpaintExpandModeKey(scope)));
}

export function writeLocalInpaintExpandMode(
  scope: string | null | undefined,
  mode: LocalInpaintExpandMode
): void {
  writeLocalString(localInpaintExpandModeKey(scope), mode === 'auto' ? 'auto' : String(Math.round(mode)));
}

export function labelForLocalInpaintExpandMode(mode: LocalInpaintExpandMode): string {
  const hit = LOCAL_INPAINT_EXPAND_PRESETS.find((p) => p.mode === mode);
  return hit?.label ?? '自动';
}
