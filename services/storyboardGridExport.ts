import { readLocalJson, writeLocalJson } from './clientPersist';
import type { StoryboardParseFieldDef } from '../types';
import type { StoryboardDurationGroup } from './storyboardGridDurationGroups';
import {
  renderStoryboardGroupMosaicBlob,
  storyboardGroupMosaicExportFilename,
} from './storyboardFrameStripMerge';

export const STORYBOARD_GRID_EXPORT_WIDTH_KEY = 'ac_storyboard_grid_export_width_v1';
export const STORYBOARD_GRID_OVERLAY_ROLE_MARKS_KEY = 'ac_storyboard_grid_overlay_role_marks_v1';

export const STORYBOARD_GRID_EXPORT_WIDTH_PRESETS = [1920, 2560, 3840] as const;

export function normalizeStoryboardGridExportWidth(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 2560;
  return Math.min(8192, Math.max(960, Math.round(n)));
}

export function readStoryboardGridExportWidth(): number {
  return normalizeStoryboardGridExportWidth(
    readLocalJson(STORYBOARD_GRID_EXPORT_WIDTH_KEY, 2560, (v) => v)
  );
}

export function writeStoryboardGridExportWidth(width: number): void {
  writeLocalJson(STORYBOARD_GRID_EXPORT_WIDTH_KEY, normalizeStoryboardGridExportWidth(width));
}

export function readStoryboardGridOverlayRoleMarks(): boolean {
  return readLocalJson(STORYBOARD_GRID_OVERLAY_ROLE_MARKS_KEY, false, (v) =>
    typeof v === 'boolean' ? v : null
  );
}

export function writeStoryboardGridOverlayRoleMarks(enabled: boolean): void {
  writeLocalJson(STORYBOARD_GRID_OVERLAY_ROLE_MARKS_KEY, enabled);
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadStoryboardGroupMosaic(
  group: StoryboardDurationGroup,
  fieldCatalog: StoryboardParseFieldDef[],
  exportWidth: number,
  overlayRoleMarks = false
): Promise<string | null> {
  const blob = await renderStoryboardGroupMosaicBlob(
    group,
    fieldCatalog,
    exportWidth,
    overlayRoleMarks
  );
  if (!blob) return null;
  const filename = storyboardGroupMosaicExportFilename(group, exportWidth);
  triggerBlobDownload(blob, filename);
  return filename;
}

export async function downloadAllStoryboardGroupMosaics(
  groups: StoryboardDurationGroup[],
  fieldCatalog: StoryboardParseFieldDef[],
  exportWidth: number,
  overlayRoleMarks = false,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  let count = 0;
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i]!;
    const ok = await downloadStoryboardGroupMosaic(
      group,
      fieldCatalog,
      exportWidth,
      overlayRoleMarks
    );
    if (ok) count += 1;
    onProgress?.(i + 1, groups.length);
    if (i < groups.length - 1) {
      await new Promise((r) => window.setTimeout(r, 120));
    }
  }
  return count;
}
