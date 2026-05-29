import { describe, expect, it } from 'vitest';
import {
  resolveStoryboardFrameDisplaySrc,
  resolveStoryboardRowFrameDisplaySrc,
  storyboardRowHasFrameRef,
} from '../services/storyboardFrameImageUrl';

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

  it('row helpers resolve object key and detect refs', () => {
    const row = {
      frameImage: '',
      frameImageObjectKey: 'users/foo/bar.jpg',
    };
    expect(storyboardRowHasFrameRef(row)).toBe(true);
    expect(resolveStoryboardRowFrameDisplaySrc(row)).toContain('/api/r2/objects/');
    expect(storyboardRowHasFrameRef({ frameImageCompanionKey: 'ck' })).toBe(true);
  });
});
