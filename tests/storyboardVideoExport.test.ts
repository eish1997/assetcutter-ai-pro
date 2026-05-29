import { describe, expect, it } from 'vitest';
import {
  countStoryboardExportFrames,
  describeStoryboardWebmMime,
  pickStoryboardWebmMimeType,
  storyboardWebmExportFilename,
} from '../services/storyboardVideoExport';

describe('storyboardVideoExport', () => {
  it('picks first supported webm mime', () => {
    const mime = pickStoryboardWebmMimeType((m) => m === 'video/webm;codecs=vp8');
    expect(mime).toBe('video/webm;codecs=vp8');
  });

  it('returns null when nothing supported', () => {
    expect(pickStoryboardWebmMimeType(() => false)).toBeNull();
  });

  it('describes mime for ui', () => {
    expect(describeStoryboardWebmMime('video/webm;codecs=vp9')).toBe('WebM · VP9');
    expect(describeStoryboardWebmMime('video/webm')).toBe('WebM');
  });

  it('counts export frames', () => {
    expect(
      countStoryboardExportFrames([
        { rowId: 'a', index: 0, shotNo: '01', durationSec: 2, durationIsEstimated: false, shotText: '' },
        { rowId: 'b', index: 1, shotNo: '02', durationSec: 1, durationIsEstimated: false, shotText: '' },
      ])
    ).toBe(90);
  });

  it('builds download filename', () => {
    expect(storyboardWebmExportFilename(123)).toBe('storyboard-preview-123.webm');
  });
});
