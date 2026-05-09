import { describe, expect, it } from 'vitest';
import {
  parseSamSegmentPromptV1,
  resolveSamSegmentKeys,
} from '../local-companion/src/compute/samSegmentAdapter';

describe('resolveSamSegmentKeys', () => {
  const prompt = {
    coordSpace: 'pixel' as const,
    width: 100,
    height: 80,
    points: [{ x: 10, y: 20, label: 1 }],
  };

  it('accepts valid inputs + params.prompt', () => {
    const r = resolveSamSegmentKeys('proj-1', { imageKey: 'a/b.png', outputKey: 'a/mask.png' }, { prompt });
    expect('ok' in r).toBe(true);
    if (!('ok' in r)) throw new Error('expected ok branch');
    expect(r.ok.imageKey).toBe('a/b.png');
    expect(r.ok.outputKey).toBe('a/mask.png');
    expect(r.ok.prompt.width).toBe(100);
  });

  it('fails without projectId', () => {
    const r = resolveSamSegmentKeys(undefined, { imageKey: 'a', outputKey: 'b' }, { prompt });
    expect('error' in r && r.code).toBe('COMPUTE_BAD_JOB');
  });

  it('fails without prompt', () => {
    const r = resolveSamSegmentKeys('p', { imageKey: 'a', outputKey: 'b' }, {});
    expect('error' in r && r.code).toBe('COMPUTE_BAD_JOB');
  });
});

describe('parseSamSegmentPromptV1', () => {
  it('rejects non-pixel coordSpace', () => {
    const r = parseSamSegmentPromptV1({ coordSpace: 'norm', width: 1, height: 1 });
    expect('error' in r).toBe(true);
  });

  it('accepts autoSegment without points (Automatic Mask Generator)', () => {
    const r = parseSamSegmentPromptV1({
      coordSpace: 'pixel',
      width: 640,
      height: 480,
      autoSegment: true,
    });
    expect('ok' in r).toBe(true);
    if (!('ok' in r)) throw new Error('expected ok branch');
    expect(r.ok.autoSegment).toBe(true);
    expect(r.ok.returnAllMasks).toBe(true);
    expect(r.ok.multimaskOutput).toBe(true);
  });
});
