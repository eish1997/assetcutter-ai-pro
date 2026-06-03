import type {
  StoryboardFrameRoleMark,
  StoryboardRoleAsset,
  StoryboardTableRow,
} from '../types';
import { storyboardRowHasFrameRef } from './storyboardFrameImageUrl';
import { storyboardNamedAssetHasImageRef } from './storyboardNamedAssetImage';

/** 与 storyboardTableRedraw.isStoryboardFeedbackRedrawEligible 一致，供 UI 筛选等轻量路径使用 */
export function isStoryboardFeedbackRedrawEligible(row: StoryboardTableRow): boolean {
  if (row.locked) return false;
  if (!(row.editFeedback ?? '').trim()) return false;
  return storyboardRowHasFrameRef(row);
}

function resolveRoleAssetForMark(
  mark: StoryboardFrameRoleMark,
  roleAssets: StoryboardRoleAsset[]
): StoryboardRoleAsset | null {
  const roleAssetId = String(mark.roleAssetId || '').trim();
  if (roleAssetId) {
    const byId = roleAssets.find((asset) => asset.id === roleAssetId);
    if (byId) return byId;
  }
  const name = String(mark.name || '').trim();
  if (!name) return null;
  return roleAssets.find((asset) => asset.name.trim() === name) ?? null;
}

function resolveRoleMarkDisplayName(
  mark: StoryboardFrameRoleMark,
  roleAssets: StoryboardRoleAsset[]
): string {
  const asset = resolveRoleAssetForMark(mark, roleAssets);
  const fromAsset = asset?.name.trim();
  if (fromAsset) return fromAsset;
  return String(mark.name || '').trim();
}

/** 与 storyboardRoleReplaceRedraw.isStoryboardRoleReplaceEligible 一致，供 UI 筛选等轻量路径使用 */
export function isStoryboardRoleReplaceEligible(
  row: StoryboardTableRow,
  roleAssets: StoryboardRoleAsset[]
): boolean {
  if (row.locked || !storyboardRowHasFrameRef(row)) return false;
  const marks = row.frameRoleMarks ?? [];
  if (!marks.length) return false;
  return marks.every((mark) => {
    if (!resolveRoleMarkDisplayName(mark, roleAssets)) return false;
    const asset = resolveRoleAssetForMark(mark, roleAssets);
    return Boolean(asset && storyboardNamedAssetHasImageRef(asset));
  });
}

export function buildStoryboardRoleReplaceEligibleRowIds(
  rows: StoryboardTableRow[],
  roleAssets: StoryboardRoleAsset[]
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (isStoryboardRoleReplaceEligible(row, roleAssets)) ids.add(row.id);
  }
  return ids;
}
