import { describe, expect, it } from 'vitest';
import {
  estimateSheetCellTextDensity,
  resolveStoryboardSheetCellFontSize,
  sheetPanelShowsDialogue,
} from '../services/storyboardSheetCellTypography';

describe('storyboardSheetCellTypography', () => {
  it('hides placeholder dialogue', () => {
    expect(sheetPanelShowsDialogue('-')).toBe(false);
    expect(sheetPanelShowsDialogue('你好')).toBe(true);
  });

  it('shrinks font when text density is high', () => {
    const sparse = resolveStoryboardSheetCellFontSize(
      { headerLine: 'SC01', visualLine: '夜景', dialogueLine: '-' },
      960
    );
    const dense = resolveStoryboardSheetCellFontSize(
      {
        headerLine: 'SC01_SH001 | 大远景 | 平视 | 固定',
        visualLine:
          '办公室内景，昏暗光线，奢华陈设，林峰独自站在巨大的落地窗前，俯瞰着脚下川流不息的城市夜景，手中端着一杯未动的威士忌。',
        dialogueLine: '旁白：这座城市从不睡觉。',
      },
      960
    );
    expect(dense.fontSizePx).toBeLessThan(sparse.fontSizePx);
    expect(dense.showDialogue).toBe(true);
    expect(sparse.showDialogue).toBe(false);
  });

  it('scores density with dialogue only when present', () => {
    const a = estimateSheetCellTextDensity({
      headerLine: 'A',
      visualLine: 'B',
      dialogueLine: '-',
    });
    const b = estimateSheetCellTextDensity({
      headerLine: 'A',
      visualLine: 'B',
      dialogueLine: '台词',
    });
    expect(b).toBeGreaterThan(a);
  });
});
