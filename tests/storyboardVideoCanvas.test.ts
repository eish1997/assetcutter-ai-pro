import { describe, expect, it } from 'vitest';
import { storyboardVideoFrameLayoutMetrics } from '../services/storyboardVideoCanvas';

describe('storyboardVideoCanvas layout', () => {
  it('16:9 reserves more height for image than legacy-heavy footer', () => {
    const withOverlay = storyboardVideoFrameLayoutMetrics(1920, 1080, true);
    expect(withOverlay.imageShare).toBeGreaterThan(0.72);
    expect(withOverlay.overlayBodySize).toBeGreaterThanOrEqual(12);
  });

  it('9:16 keeps readable overlay text with taller footer band', () => {
    const withOverlay = storyboardVideoFrameLayoutMetrics(1080, 1920, true);
    expect(withOverlay.overlayBand).toBeGreaterThan(0);
    expect(withOverlay.textZoneHeight).toBeGreaterThan(40);
  });

  it('1:1 balances image and chrome', () => {
    const noOverlay = storyboardVideoFrameLayoutMetrics(1080, 1080, false);
    expect(noOverlay.imageShare).toBeGreaterThan(0.8);
  });

  it('empty overlay lines use compact footer even when catalog exists', () => {
    const catalogOnly = storyboardVideoFrameLayoutMetrics(1920, 1080, false);
    const withOverlay = storyboardVideoFrameLayoutMetrics(1920, 1080, true);
    expect(withOverlay.overlayBand).toBeGreaterThan(catalogOnly.overlayBand);
    expect(catalogOnly.imageShare).toBeGreaterThan(withOverlay.imageShare);
  });
});
