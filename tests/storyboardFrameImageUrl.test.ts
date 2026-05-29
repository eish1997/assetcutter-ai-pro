import { describe, expect, it } from 'vitest';
import { resolveStoryboardFrameDisplaySrc } from '../services/storyboardFrameImageUrl';

describe('storyboardFrameImageUrl', () => {
  it('passes through data URLs', () => {
    const data = 'data:image/jpeg;base64,abc';
    expect(resolveStoryboardFrameDisplaySrc(data)).toBe(data);
  });

  it('builds object key path', () => {
    expect(resolveStoryboardFrameDisplaySrc('', 'users/foo/bar.jpg')).toBe('/api/r2/objects/users/foo/bar.jpg');
  });

  it('keeps persisted api path', () => {
    expect(resolveStoryboardFrameDisplaySrc('/api/r2/objects/users/x.jpg')).toBe(
      '/api/r2/objects/users/x.jpg'
    );
  });
});
