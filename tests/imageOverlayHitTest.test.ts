import { describe, expect, it } from 'vitest';
import { hitTestOverlayAnnotation } from '../services/imageOverlayHitTest';
import type { ImageOverlayAnnotationDoc } from '../types';

describe('imageOverlayHitTest', () => {
  it('hits topmost crop over underlying rect', () => {
    const doc: ImageOverlayAnnotationDoc = {
      v: 1,
      items: [
        {
          id: 'r1',
          kind: 'rect',
          x: 0.1,
          y: 0.1,
          w: 0.5,
          h: 0.5,
          stroke: '#fff',
          sw: 2,
        },
      ],
      crops: [{ id: 'c1', kind: 'crop_rect', x: 0.2, y: 0.2, w: 0.3, h: 0.3 }],
    };
    const hit = hitTestOverlayAnnotation({ x: 0.35, y: 0.35 }, doc, 800, 600);
    expect(hit?.kind).toBe('crop');
    expect(hit?.id).toBe('c1');
  });
});
