import { describe, expect, it } from 'vitest';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import {
  chunkStoryboardRowsByCount,
  compileSheetRedrawPrompt,
  planStoryboardSheetGenTasks,
  resolveSheetGenSourceRows,
  sheetGenTaskCount,
} from '../services/storyboardTableSheetGen';

const catalog: StoryboardParseFieldDef[] = [
  { id: 'f_visual', label: '画面内容', order: 0, redrawInclude: true, kind: 'text' },
  { id: 'f_size', label: '景别', order: 1, redrawInclude: true, kind: 'text' },
];

const row = (partial: Partial<StoryboardTableRow>): StoryboardTableRow => ({
  id: partial.id || 'r1',
  index: partial.index ?? 0,
  shotFields: partial.shotFields ?? {},
  shotText: partial.shotText ?? '',
  ...partial,
});

const SAMPLE_PIPE = `镜头号 | 景别 | 画面内容
SC01 | 远景 | 城市夜景
SC02 | 全景 | 办公室内景`;

describe('storyboardTableSheetGen', () => {
  it('chunks rows by shots per sheet', () => {
    const items = Array.from({ length: 7 }, (_, i) => i);
    expect(chunkStoryboardRowsByCount(items, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(sheetGenTaskCount(200, 25)).toBe(8);
  });

  it('plans sheet gen tasks', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ id: `r${i}`, index: i, shotNo: `S${i}`, shotFields: { f_visual: `画面${i}` } })
    );
    const tasks = planStoryboardSheetGenTasks(rows, 2);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]?.rowIds).toEqual(['r0', 'r1']);
    expect(tasks[2]?.rowIds).toEqual(['r4']);
  });

  it('compiles multi-shot sheet prompt', () => {
    const rows = [
      row({ shotNo: 'SC01', shotFields: { f_visual: '夜景', f_size: '远景' } }),
      row({ shotNo: 'SC02', shotFields: { f_visual: '办公室' } }),
    ];
    const prompt = compileSheetRedrawPrompt(rows, catalog, { promptExtra: '电影感' });
    expect(prompt.startsWith('电影感')).toBe(true);
    expect(prompt).toContain('--- SC01 ---');
    expect(prompt).toContain('【画面内容】夜景');
    expect(prompt).not.toContain('contact sheet');
  });

  it('falls back to bulk draft when table rows lack prompts', () => {
    const resolved = resolveSheetGenSourceRows([], SAMPLE_PIPE, 'pipe', catalog);
    expect(resolved.source).toBe('draft');
    expect(resolved.rows).toHaveLength(2);
    expect(resolved.rows[0]?.shotNo).toBe('SC01');
  });
});
