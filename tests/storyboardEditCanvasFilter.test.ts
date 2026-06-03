import { describe, expect, it } from 'vitest';
import {
  buildStoryboardEditCanvasFilterMatchedIds,
  computeStoryboardEditCanvasFilterCounts,
  computeStoryboardEditCanvasFilterState,
  parseStoryboardEditCanvasFilterPill,
  storyboardRowMatchesEditCanvasFilter,
} from '../services/storyboardEditCanvasFilter';
import { isStoryboardFeedbackRedrawEligible as isStoryboardFeedbackRedrawEligibleLite } from '../services/storyboardEditEligibility';
import { isStoryboardFeedbackRedrawEligible as isStoryboardFeedbackRedrawEligibleRedraw } from '../services/storyboardTableRedraw';
import type { StoryboardRoleAsset, StoryboardTableRow } from '../types';

const roleAssets: StoryboardRoleAsset[] = [
  {
    id: 'r1',
    name: '小明',
    image: 'data:image/png;base64,abc',
  },
];

function row(partial: Partial<StoryboardTableRow> & Pick<StoryboardTableRow, 'id'>): StoryboardTableRow {
  return {
    index: 0,
    shotText: '',
    shotFields: {},
    ...partial,
  };
}

describe('storyboardEditCanvasFilter', () => {
  it('parseStoryboardEditCanvasFilterPill accepts known ids', () => {
    expect(parseStoryboardEditCanvasFilterPill('feedbackRedraw')).toBe('feedbackRedraw');
    expect(parseStoryboardEditCanvasFilterPill('nope')).toBeNull();
  });

  it('counts align with row predicates', () => {
    const rows = [
      row({
        id: 'a',
        editFeedback: '改背景',
        frameImage: 'data:image/png;base64,x',
        frameRoleMarks: [{ id: 'm1', name: '小明', x: 0.5, y: 0.5, roleAssetId: 'r1' }],
      }),
      row({ id: 'b', locked: true, editFeedback: 'x', frameImage: 'data:image/png;base64,y' }),
      row({ id: 'c' }),
    ];

    const counts = computeStoryboardEditCanvasFilterCounts(rows, roleAssets);
    expect(counts.feedback).toBe(2);
    expect(counts.feedbackRedraw).toBe(1);
    expect(counts.roleReplace).toBe(1);
    expect(counts.missingImage).toBe(1);
    expect(counts.passed).toBe(1);
  });

  it('buildStoryboardEditCanvasFilterMatchedIds returns null for all', () => {
    const rows = [row({ id: 'a', editFeedback: 'x' })];
    expect(buildStoryboardEditCanvasFilterMatchedIds(rows, 'all', roleAssets)).toBeNull();
  });

  it('storyboardRowMatchesEditCanvasFilter for each pill', () => {
    const eligible = row({
      id: 'ok',
      editFeedback: '改',
      frameImage: 'data:image/png;base64,x',
      frameRoleMarks: [{ id: 'm1', name: '小明', x: 0.3, y: 0.4, roleAssetId: 'r1' }],
    });
    expect(storyboardRowMatchesEditCanvasFilter(eligible, 'feedback', roleAssets)).toBe(true);
    expect(storyboardRowMatchesEditCanvasFilter(eligible, 'feedbackRedraw', roleAssets)).toBe(true);
    expect(storyboardRowMatchesEditCanvasFilter(eligible, 'roleReplace', roleAssets)).toBe(true);
    expect(storyboardRowMatchesEditCanvasFilter(eligible, 'missingImage', roleAssets)).toBe(false);
    expect(storyboardRowMatchesEditCanvasFilter(eligible, 'passed', roleAssets)).toBe(false);
  });

  it('computeStoryboardEditCanvasFilterState aligns matched ids with pill', () => {
    const rows = [
      row({ id: 'a', editFeedback: 'x', frameImage: 'data:image/png;base64,1' }),
      row({ id: 'b' }),
    ];
    const state = computeStoryboardEditCanvasFilterState(rows, 'feedbackRedraw', roleAssets);
    expect(state.counts.feedbackRedraw).toBe(1);
    expect(state.matchedRowIds).toEqual(new Set(['a']));
    expect(state.roleReplaceEligibleRowIds.size).toBe(0);
    expect(computeStoryboardEditCanvasFilterCounts(rows, roleAssets)).toEqual(state.counts);
    expect(buildStoryboardEditCanvasFilterMatchedIds(rows, 'feedbackRedraw', roleAssets)).toEqual(
      state.matchedRowIds
    );
  });

  it('feedback redraw eligibility matches tableRedraw re-export', () => {
    const sample = row({ id: 'x', editFeedback: '改', frameImage: 'data:image/png;base64,z' });
    expect(isStoryboardFeedbackRedrawEligibleLite(sample)).toBe(
      isStoryboardFeedbackRedrawEligibleRedraw(sample)
    );
  });
});
