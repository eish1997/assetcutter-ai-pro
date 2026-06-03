import { describe, expect, it } from 'vitest';
import type { StoryboardTableRow } from '../types';
import {
  compileFeedbackSheetShotPanelMeta,
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
    shotFields: { visual: '雨夜街头' },
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

  it('includes only feedback in sheet prompt (no storyboard text)', () => {
    const prompt = compileStoryboardFeedbackSheetPrompt([mockRow()]);
    expect(prompt).toContain('把天空改蓝');
    expect(prompt).toContain('画风');
    expect(prompt).not.toContain('雨夜街头');
    expect(prompt).not.toContain('画面描述');
    expect(prompt).not.toContain('顶栏：');
    expect(prompt).not.toContain('修改反馈：');
  });

  it('uses grid labels for multi-row collage prompt', () => {
    const prompt = compileStoryboardFeedbackSheetPrompt([
      mockRow({ shotNo: '001', editFeedback: '改 A' }),
      mockRow({ id: 'r2', index: 1, shotNo: '002', editFeedback: '改 B' }),
    ]);
    expect(prompt).toContain('多格拼图');
    expect(prompt).toContain('格 001：改 A');
    expect(prompt).toContain('格 002：改 B');
  });

  it('builds feedback cell meta without embedded feedback text', () => {
    const meta = compileFeedbackSheetShotPanelMeta(mockRow());
    expect(meta.compactLayout?.extraLines).toEqual([]);
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
