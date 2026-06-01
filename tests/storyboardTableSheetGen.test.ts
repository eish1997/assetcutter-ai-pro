import { describe, expect, it } from 'vitest';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import {
  WORKFLOW_IMAGE_GEN_PROMPT_RECOMMENDED_MAX_CHARS,
} from '../services/workflowTextLimits';
import {
  buildStoryboardSheetGenBatchPreviews,
  buildStoryboardSheetGenMergedSendPrompt,
  chunkStoryboardRowsByCount,
  compileSheetRedrawPrompt,
  measureStoryboardSheetGenPrompt,
  planStoryboardSheetGenTasks,
  resolveSheetGenSourceRows,
  resolveStoryboardSheetGridDimensions,
  sheetGenTaskCount,
  validateStoryboardSheetGenPromptLength,
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

const directPreset = {
  id: 't2i',
  label: '分镜图',
  category: 'text_to_image',
  enabled: true,
  skipUnderstand: true,
} as import('../types').CustomAppModule;

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

  it('compiles multi-shot sheet prompt with compact layout', () => {
    const rows = [
      row({ shotNo: 'SC01', shotFields: { f_visual: '夜景', f_size: '远景' } }),
      row({ shotNo: 'SC02', shotFields: { f_visual: '办公室' } }),
    ];
    const prompt = compileSheetRedrawPrompt(rows, catalog, { promptExtra: '电影感' });
    expect(prompt.startsWith('电影感')).toBe(true);
    expect(prompt).toContain('【拼图排版·紧凑】');
    expect(prompt).toContain('2 列 × 2 行');
    expect(prompt).toContain('--- SC01 ---');
    expect(prompt).toContain('顶栏：SC01');
    expect(prompt).toContain('画面：夜景');
    expect(prompt).not.toContain('contact sheet');
  });

  it('does not truncate per-shot visual lines in compact block', () => {
    const longVisual = '叶不凡'.repeat(80);
    const rows = [row({ shotNo: '049', shotFields: { f_visual: longVisual } })];
    const prompt = compileSheetRedrawPrompt(rows, catalog);
    expect(prompt).toContain(longVisual);
  });

  it('measureStoryboardSheetGenPrompt counts preset merge', () => {
    const compiled = compileSheetRedrawPrompt(
      [row({ shotFields: { f_visual: '测试' } })],
      catalog
    );
    const stats = measureStoryboardSheetGenPrompt(compiled, {
      ...directPreset,
      instruction: '手绘风格',
    });
    expect(stats.compiledChars).toBeGreaterThan(0);
    expect(stats.presetChars).toBe('手绘风格'.length);
    expect(stats.mergedChars).toBeGreaterThan(stats.compiledChars);
  });

  it('buildStoryboardSheetGenMergedSendPrompt merges preset and compiled body', () => {
    const compiled = compileSheetRedrawPrompt(
      [row({ shotFields: { f_visual: '测试' } })],
      catalog
    );
    const merged = buildStoryboardSheetGenMergedSendPrompt(compiled, {
      ...directPreset,
      instruction: '手绘风格',
    });
    expect(merged.startsWith('手绘风格')).toBe(true);
    expect(merged).toContain(compiled);
  });

  it('buildStoryboardSheetGenBatchPreviews returns per-chunk send preview', () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      row({ id: `r${i}`, index: i, shotNo: `S${i}`, shotFields: { f_visual: `画面${i}` } })
    );
    const tasks = planStoryboardSheetGenTasks(rows, 2);
    const previews = buildStoryboardSheetGenBatchPreviews({
      tasks,
      fieldCatalog: catalog,
      promptExtra: '',
      preset: directPreset,
    });
    expect(previews).toHaveLength(2);
    expect(previews[0]?.directSend).toBe(true);
    expect(previews[0]?.mergedImagePrompt).toContain('画面0');
    expect(previews[1]?.shotCount).toBe(1);
  });

  it('resolves compact grid dimensions', () => {
    expect(resolveStoryboardSheetGridDimensions(7)).toEqual({ cols: 3, rows: 3 });
    expect(resolveStoryboardSheetGridDimensions(12)).toEqual({ cols: 4, rows: 3 });
  });

  it('falls back to bulk draft when table rows lack prompts', () => {
    const resolved = resolveSheetGenSourceRows([], SAMPLE_PIPE, 'pipe', catalog);
    expect(resolved.source).toBe('draft');
    expect(resolved.rows).toHaveLength(2);
    expect(resolved.rows[0]?.shotNo).toBe('SC01');
  });

  it('validateStoryboardSheetGenPromptLength rejects understand on multi-shot collage', () => {
    const compiled = compileSheetRedrawPrompt(
      [row({ shotFields: { f_visual: 'A' } }), row({ shotFields: { f_visual: 'B' } })],
      catalog
    );
    const result = validateStoryboardSheetGenPromptLength(
      compiled,
      { ...directPreset, skipUnderstand: false },
      {},
      { shotCount: 2 }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('直发提示词');
    }
  });

  it('validateStoryboardSheetGenPromptLength rejects merged over recommended limit', () => {
    const compiled = 'x'.repeat(WORKFLOW_IMAGE_GEN_PROMPT_RECOMMENDED_MAX_CHARS + 1);
    const result = validateStoryboardSheetGenPromptLength(compiled, directPreset, {}, { shotCount: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stats.mergedChars).toBeGreaterThan(WORKFLOW_IMAGE_GEN_PROMPT_RECOMMENDED_MAX_CHARS);
      expect(result.error).toContain('不会截断');
    }
  });
});
