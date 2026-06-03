import type { StoryboardRoleAsset, StoryboardTableRow } from '../types';
import { storyboardRowHasFrameRef } from './storyboardFrameImageUrl';
import {
  isStoryboardFeedbackRedrawEligible,
  isStoryboardRoleReplaceEligible,
} from './storyboardEditEligibility';

function storyboardRowHasEditFeedback(row: StoryboardTableRow): boolean {
  return Boolean((row.editFeedback ?? '').trim());
}

function storyboardRowIsPassed(row: Pick<StoryboardTableRow, 'locked'>): boolean {
  return Boolean(row.locked);
}

export const STORYBOARD_EDIT_CANVAS_FILTER_KEY = 'ac_storyboard_edit_canvas_filter_v1';

export type StoryboardEditCanvasFilterPill =
  | 'all'
  | 'feedback'
  | 'feedbackRedraw'
  | 'roleReplace'
  | 'missingImage'
  | 'passed';

export type StoryboardEditCanvasFilterCounts = {
  feedback: number;
  feedbackRedraw: number;
  roleReplace: number;
  missingImage: number;
  passed: number;
};

export type StoryboardEditCanvasFilterPillMeta = {
  id: Exclude<StoryboardEditCanvasFilterPill, 'all'>;
  label: string;
  emptyHint: string;
};

export const STORYBOARD_EDIT_CANVAS_FILTER_PILLS: StoryboardEditCanvasFilterPillMeta[] = [
  {
    id: 'feedback',
    label: '待反馈',
    emptyHint: '暂无已写反馈的镜头 · 在右侧编辑轨填写修改反馈',
  },
  {
    id: 'feedbackRedraw',
    label: '可改图',
    emptyHint: '暂无可拼图改图的镜头 · 需已配图、已写反馈且未通过',
  },
  {
    id: 'roleReplace',
    label: '可换角色',
    emptyHint:
      '暂无可替换角色的镜头 · 需配图、角色标注，且解析页角色有参考图',
  },
  {
    id: 'missingImage',
    label: '缺配图',
    emptyHint: '全部镜头已配图',
  },
  {
    id: 'passed',
    label: '已通过',
    emptyHint: '暂无已通过镜头',
  },
];

const FILTER_PILL_SET = new Set<string>([
  'all',
  'feedback',
  'feedbackRedraw',
  'roleReplace',
  'missingImage',
  'passed',
]);

export function parseStoryboardEditCanvasFilterPill(
  value: unknown
): StoryboardEditCanvasFilterPill | null {
  const id = String(value || '').trim();
  return FILTER_PILL_SET.has(id) ? (id as StoryboardEditCanvasFilterPill) : null;
}

export function storyboardEditCanvasFilterPillLabel(
  pill: StoryboardEditCanvasFilterPill
): string {
  if (pill === 'all') return '全部';
  return STORYBOARD_EDIT_CANVAS_FILTER_PILLS.find((item) => item.id === pill)?.label ?? pill;
}

export function storyboardEditCanvasFilterEmptyHint(
  pill: Exclude<StoryboardEditCanvasFilterPill, 'all'>
): string {
  return (
    STORYBOARD_EDIT_CANVAS_FILTER_PILLS.find((item) => item.id === pill)?.emptyHint ??
    '暂无命中镜头'
  );
}

export function storyboardRowMatchesEditCanvasFilter(
  row: StoryboardTableRow,
  pill: Exclude<StoryboardEditCanvasFilterPill, 'all'>,
  roleAssets: StoryboardRoleAsset[]
): boolean {
  switch (pill) {
    case 'feedback':
      return storyboardRowHasEditFeedback(row);
    case 'feedbackRedraw':
      return isStoryboardFeedbackRedrawEligible(row);
    case 'roleReplace':
      return isStoryboardRoleReplaceEligible(row, roleAssets);
    case 'missingImage':
      return !storyboardRowHasFrameRef(row);
    case 'passed':
      return storyboardRowIsPassed(row);
    default:
      return false;
  }
}

export function computeStoryboardEditCanvasFilterCounts(
  rows: StoryboardTableRow[],
  roleAssets: StoryboardRoleAsset[]
): StoryboardEditCanvasFilterCounts {
  return computeStoryboardEditCanvasFilterState(rows, 'all', roleAssets).counts;
}

export function buildStoryboardEditCanvasFilterMatchedIds(
  rows: StoryboardTableRow[],
  pill: StoryboardEditCanvasFilterPill,
  roleAssets: StoryboardRoleAsset[]
): Set<string> | null {
  return computeStoryboardEditCanvasFilterState(rows, pill, roleAssets).matchedRowIds;
}

export type StoryboardEditCanvasFilterState = {
  counts: StoryboardEditCanvasFilterCounts;
  matchedRowIds: Set<string> | null;
  roleReplaceEligibleRowIds: Set<string>;
};

/** 单次遍历：计数 + 当前 pill 命中集 + 可换角色镜 id */
export function computeStoryboardEditCanvasFilterState(
  rows: StoryboardTableRow[],
  pill: StoryboardEditCanvasFilterPill,
  roleAssets: StoryboardRoleAsset[]
): StoryboardEditCanvasFilterState {
  const counts: StoryboardEditCanvasFilterCounts = {
    feedback: 0,
    feedbackRedraw: 0,
    roleReplace: 0,
    missingImage: 0,
    passed: 0,
  };
  const roleReplaceEligibleRowIds = new Set<string>();
  const matched = pill === 'all' ? null : new Set<string>();

  for (const row of rows) {
    if (storyboardRowHasEditFeedback(row)) counts.feedback += 1;
    if (isStoryboardFeedbackRedrawEligible(row)) counts.feedbackRedraw += 1;
    if (isStoryboardRoleReplaceEligible(row, roleAssets)) {
      counts.roleReplace += 1;
      roleReplaceEligibleRowIds.add(row.id);
    }
    if (!storyboardRowHasFrameRef(row)) counts.missingImage += 1;
    if (storyboardRowIsPassed(row)) counts.passed += 1;
    if (matched && storyboardRowMatchesEditCanvasFilter(row, pill, roleAssets)) {
      matched.add(row.id);
    }
  }

  return { counts, matchedRowIds: matched, roleReplaceEligibleRowIds };
}

export function storyboardEditCanvasFilterAccentClass(
  pill: Exclude<StoryboardEditCanvasFilterPill, 'all'>
): string {
  switch (pill) {
    case 'feedback':
    case 'feedbackRedraw':
      return 'bg-sky-400/80';
    case 'roleReplace':
      return 'bg-emerald-400/80';
    case 'missingImage':
      return 'bg-amber-400/80';
    case 'passed':
      return 'bg-violet-400/70';
    default:
      return 'bg-white/40';
  }
}
