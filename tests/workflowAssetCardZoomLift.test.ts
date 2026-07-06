import { describe, expect, it } from 'vitest';
import {
  computeWorkflowCardZoomTransform,
  viewportRectToFixedLocalPosition,
  WORKFLOW_CARD_ZOOM_MAX_SCALE,
  WORKFLOW_CARD_ZOOM_VIEWPORT_MARGIN_PX,
} from '../services/workflowAssetCardZoomLift';

describe('computeWorkflowCardZoomTransform', () => {
  it('centers scaled card in viewport without exceeding margins', () => {
    const rect = { left: 40, top: 120, width: 200, height: 150, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    const viewport = { w: 1000, h: 800 };
    const { scale, translateX, translateY } = computeWorkflowCardZoomTransform(rect, viewport);

    expect(scale).toBeLessThanOrEqual(WORKFLOW_CARD_ZOOM_MAX_SCALE);
    const scaledW = rect.width * scale;
    const scaledH = rect.height * scale;
    const margin = WORKFLOW_CARD_ZOOM_VIEWPORT_MARGIN_PX;
    expect(scaledW).toBeLessThanOrEqual(viewport.w - margin * 2);
    expect(scaledH).toBeLessThanOrEqual(viewport.h - margin * 2);

    const cardCx = rect.left + rect.width / 2 + translateX;
    const cardCy = rect.top + rect.height / 2 + translateY;
    expect(cardCx).toBeCloseTo(viewport.w / 2, 0);
    expect(cardCy).toBeCloseTo(viewport.h / 2, 0);

    const boxLeft = cardCx - scaledW / 2;
    const boxTop = cardCy - scaledH / 2;
    expect(boxLeft).toBeGreaterThanOrEqual(margin - 0.5);
    expect(boxTop).toBeGreaterThanOrEqual(margin - 0.5);
    expect(boxLeft + scaledW).toBeLessThanOrEqual(viewport.w - margin + 0.5);
    expect(boxTop + scaledH).toBeLessThanOrEqual(viewport.h - margin + 0.5);
  });
});

describe('viewportRectToFixedLocalPosition', () => {
  it('offsets by transformed ancestor rect (workspace track translate3d)', () => {
    const rect = { left: 320, top: 180, width: 200, height: 150 } as DOMRect;
    const cbRect = { left: -480, top: 64, width: 2400, height: 900 } as DOMRect;
    const cb = {
      getBoundingClientRect: () => cbRect,
    } as HTMLElement;

    const pos = viewportRectToFixedLocalPosition(rect, cb);
    expect(pos.left).toBeCloseTo(800, 5);
    expect(pos.top).toBeCloseTo(116, 5);
    expect(cbRect.left + pos.left).toBeCloseTo(rect.left, 5);
    expect(cbRect.top + pos.top).toBeCloseTo(rect.top, 5);
  });
});
