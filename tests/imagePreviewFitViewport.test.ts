// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  fitImageToPreviewViewport,
  lockByOriginalDominantAxis,
  measureLightboxFlatFitBox,
} from '../services/imagePreviewFitViewport';

describe('imagePreviewFitViewport', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('contain-fits a landscape image into a given box', () => {
    const fit = fitImageToPreviewViewport(1024, 576, { maxW: 1552, maxH: 708 });
    expect(fit.h).toBeCloseTo(708, 5);
    expect(fit.w).toBeCloseTo(1258.666, 0);
  });

  it('uses the flat well size when present', () => {
    const well = document.createElement('div');
    well.setAttribute('data-lightbox-flat-well', '');
    well.getBoundingClientRect = () =>
      ({
        width: 1480,
        height: 820,
        top: 44,
        left: 8,
        right: 1488,
        bottom: 864,
        x: 8,
        y: 44,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.append(well);

    const box = measureLightboxFlatFitBox(document, { width: 1600, height: 900 });
    expect(box).toEqual({ maxW: 1480, maxH: 820 });

    const lock = lockByOriginalDominantAxis(1024, 576, box);
    expect(lock.axis).toBe('width');
    expect(lock.size).toBeCloseTo(1457.78, 1);
    expect(fitImageToPreviewViewport(1024, 576, box).h).toBeCloseTo(820, 5);
  });
});
