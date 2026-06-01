import { describe, expect, it } from 'vitest';
import type { StoryboardTableRow } from '../types';
import {
  compileFeedbackSheetShotPanelMeta,
  compileStoryboardEditCollagePrompt,
  compileStoryboardFeedbackSheetPrompt,
  normalizeFeedbackCollageLimit,
  planStoryboardFeedbackRedrawTasks,
} from '../services/storyboardFeedbackSheetRedraw';
import { pixelRectToNormBox, trimImageDataUrlContentBounds } from '../services/storyboardFeedbackCollageSplit';

function mockRow(overrides: Partial<StoryboardTableRow> = {}): StoryboardTableRow {
  return {
    id: 'row-1',
    index: 0,
    shotNo: '001',
    shotFields: {},
    shotText: '',
    locked: false,
    editFeedback: '把天空改蓝',
    frameImage: 'data:image/png;base64,abc',
    ...overrides,
  };
}

describe('storyboardFeedbackSheetRedraw', () => {
  it('normalizes collage limit with default 9', () => {
    expect(normalizeFeedbackCollageLimit(undefined)).toBe(9);
    expect(normalizeFeedbackCollageLimit(12)).toBe(12);
  });

  it('plans tasks by collage limit', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      mockRow({ id: `r${i}`, index: i, shotNo: String(i + 1).padStart(3, '0') })
    );
    const tasks = planStoryboardFeedbackRedrawTasks(rows, 9);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.rowIds).toHaveLength(9);
    expect(tasks[1]?.rowIds).toHaveLength(1);
  });

  it('includes feedback in sheet prompt', () => {
    const prompt = compileStoryboardFeedbackSheetPrompt([mockRow()]);
    expect(prompt).toContain('本次拼图');
    expect(prompt).toContain('修改反馈：把天空改蓝');
  });

  it('includes structured fields in edit collage prompt', () => {
    const prompt = compileStoryboardEditCollagePrompt(
      [mockRow({ editFeedback: '' })],
      [{ id: 'visual', label: '画面', order: 0, redrawInclude: true }]
    );
    expect(prompt).toContain('本次拼图');
    expect(prompt).not.toContain('禁止添加 Scene Info');
  });

  it('builds feedback cell meta without embedded feedback text', () => {
    const meta = compileFeedbackSheetShotPanelMeta(mockRow());
    expect(meta.compactLayout?.extraLines).toEqual([]);
  });

  it('prompt forbids text bars and omits sheet layout template', () => {
    const prompt = compileStoryboardFeedbackSheetPrompt([mockRow()]);
    expect(prompt).not.toContain('顶栏：');
  });

  it('normalizes pixel rect to 0-1000 box', () => {
    const box = pixelRectToNormBox({ x: 100, y: 200, w: 300, h: 400 }, 1000, 2000);
    expect(box).toEqual({ xmin: 100, ymin: 100, xmax: 400, ymax: 300 });
  });

  it('trim keeps image when bottom rows are white', async () => {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 100, 80);
    ctx.fillStyle = '#333333';
    ctx.fillRect(10, 10, 80, 30);
    const src = canvas.toDataURL('image/png');
    const trimmed = await trimImageDataUrlContentBounds(src);
    const probe = new Image();
    await new Promise<void>((resolve, reject) => {
      probe.onload = () => resolve();
      probe.onerror = () => reject(new Error('load failed'));
      probe.src = trimmed;
    });
    expect(probe.naturalHeight).toBeLessThan(80);
    expect(probe.naturalHeight).toBeGreaterThan(20);
  });
});
