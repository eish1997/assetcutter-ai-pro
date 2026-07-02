import { describe, expect, it } from 'vitest';
import {
  computeQuickComposeExpandedTextMaxHeight,
  QUICK_COMPOSE_EXPANDED_CHROME_BELOW_TEXT_PX,
  QUICK_COMPOSE_MULTILINE_LINE_PX,
  QUICK_COMPOSE_VIEW_MARGIN,
} from '../services/quickComposeBarViewport';

describe('quickComposeBarViewport', () => {
  it('computes textarea max height from anchor bottom and top margin', () => {
    const barEl = {
      getBoundingClientRect: () => ({
        top: 200,
        bottom: 520,
        left: 0,
        right: 400,
        width: 400,
        height: 320,
        x: 0,
        y: 200,
        toJSON: () => ({}),
      }),
      querySelectorAll: () => [],
    } as unknown as HTMLElement;

    const maxH = computeQuickComposeExpandedTextMaxHeight(barEl, {
      anchorBottom: 520,
      viewMargin: QUICK_COMPOSE_VIEW_MARGIN,
      chromeBelowTextPx: QUICK_COMPOSE_EXPANDED_CHROME_BELOW_TEXT_PX,
    });

    const expected =
      520 - QUICK_COMPOSE_VIEW_MARGIN - QUICK_COMPOSE_EXPANDED_CHROME_BELOW_TEXT_PX;
    expect(maxH).toBe(expected);
    expect(maxH).toBeGreaterThanOrEqual(QUICK_COMPOSE_MULTILINE_LINE_PX * 3);
  });
});
