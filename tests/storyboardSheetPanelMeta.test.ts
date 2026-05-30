import { describe, expect, it } from 'vitest';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import {
  compileSheetShotPanelCompactLayout,
  compileSheetShotPanelFieldLines,
  compileSheetShotPanelMeta,
} from '../services/storyboardTableSheetGen';
import { planStoryboardSheetGroupTypography } from '../services/storyboardSheetCellTypography';

const catalog: StoryboardParseFieldDef[] = [
  { id: 'f_visual', label: '画面内容', order: 0, redrawInclude: true, kind: 'text' },
  { id: 'f_size', label: '景别', order: 1, redrawInclude: true, kind: 'text' },
  { id: 'f_angle', label: '角度', order: 2, redrawInclude: true, kind: 'text' },
  { id: 'f_move', label: '运镜', order: 3, redrawInclude: true, kind: 'text' },
  { id: 'f_light', label: '光影设计', order: 4, redrawInclude: true, kind: 'text' },
  { id: 'f_costume', label: '服化道建议', order: 5, redrawInclude: true, kind: 'text' },
];

const row = (partial: Partial<StoryboardTableRow>): StoryboardTableRow => ({
  id: partial.id || 'r1',
  index: partial.index ?? 0,
  shotFields: partial.shotFields ?? {},
  shotText: partial.shotText ?? '',
  ...partial,
});

describe('compileSheetShotPanelMeta', () => {
  it('compact header is shot | duration; short meta merges without labels', () => {
    const meta = compileSheetShotPanelMeta(
      row({
        shotNo: 'SC01_SH001',
        durationSec: 3,
        shotFields: {
          f_size: '大远景',
          f_angle: '平视',
          f_move: '固定',
          f_light: '夜景霓虹',
          f_costume: '黑色职业装',
          f_visual: '城市夜景全景，万家灯火。',
        },
      }),
      catalog
    );
    expect(meta.compactLayout.headerLine).toBe('SC01_SH001 | 3s');
    expect(meta.compactLayout.metaLine).toBe('大远景 · 平视 · 固定');
    expect(meta.compactLayout.description).toBe('城市夜景全景，万家灯火。');
    expect(meta.compactLayout.extraLines).toEqual([
      { text: '夜景霓虹' },
      { text: '黑色职业装' },
    ]);
  });

  it('includes dialogue in extra lines when redrawInclude is false', () => {
    const longDialogue = '旁白：这是一段较长的对白内容，不应被截断。';
    const fieldLines = compileSheetShotPanelFieldLines(
      row({
        shotFields: {
          f_visual: '淮北市夜景',
          f_size: '远景',
          f_dialogue: longDialogue,
        },
      }),
      [
        ...catalog,
        { id: 'f_dialogue', label: '对白', order: 6, redrawInclude: false, kind: 'text' },
      ]
    );
    const compact = compileSheetShotPanelCompactLayout(
      row({
        shotFields: {
          f_visual: '淮北市夜景',
          f_size: '远景',
          f_dialogue: longDialogue,
        },
      }),
      fieldLines
    );
    expect(
      compact.extraLines.some(
        (line) => line.text === longDialogue && line.dialogue === true
      )
    ).toBe(true);
    expect(compact.metaLine).toBe('远景');
  });

  it('merges multiple visual fields into one description', () => {
    const meta = compileSheetShotPanelMeta(
      row({
        shotFields: {
          f_visual: '城市夜景',
          f_action: '车辆驶过',
          f_size: '远景',
        },
      }),
      [
        ...catalog,
        { id: 'f_action', label: '动作描述', order: 6, redrawInclude: true, kind: 'text' },
      ]
    );
    expect(meta.compactLayout.description).toBe('城市夜景；车辆驶过');
  });

  it('skips empty placeholders and falls back to shotText', () => {
    const lines = compileSheetShotPanelFieldLines(
      row({ shotText: '原始分镜段落', shotFields: { f_visual: '-', f_size: '' } }),
      catalog
    );
    const compact = compileSheetShotPanelCompactLayout(
      row({ shotText: '原始分镜段落', shotFields: { f_visual: '-', f_size: '' } }),
      lines
    );
    expect(compact.description).toBe('原始分镜段落');
  });
});

describe('planStoryboardSheetGroupTypography', () => {
  it('uses one unified font size for the whole group', () => {
    if (typeof document === 'undefined') return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    expect(ctx).toBeTruthy();
    if (!ctx) return;

    const sparse = compileSheetShotPanelMeta(
      row({ shotNo: 'A', shotFields: { f_visual: '短', f_size: '近景' } }),
      catalog
    );
    const dense = compileSheetShotPanelMeta(
      row({
        shotNo: 'SC01_SH001',
        shotFields: {
          f_size: '大远景',
          f_visual:
            '办公室内景，昏暗光线，奢华陈设，林峰独自站在巨大的落地窗前，俯瞰着脚下川流不息的城市夜景，手中端着一杯未动的威士忌。',
        },
      }),
      catalog
    );

    const aloneSparse = planStoryboardSheetGroupTypography(ctx, [sparse], {
      cellW: 300,
      cellH: 220,
      canvasWidth: 960,
    });
    const group = planStoryboardSheetGroupTypography(ctx, [sparse, dense], {
      cellW: 300,
      cellH: 220,
      canvasWidth: 960,
    });

    expect(group.bodySize).toBeLessThanOrEqual(aloneSparse.bodySize);
  });
});
