import { describe, expect, it } from 'vitest';

import { safeEncodeURIComponent, safeSvgDataUrl } from '../services/svgDataUrl';
import { buildComposerTextAssetThumbDataUrl } from '../services/workflowTextAsset';

describe('safe SVG data URLs', () => {
  it('does not throw on malformed UTF-16 surrogate text', () => {
    const malformed = 'bad high surrogate \uD800 and bad low surrogate \uDC00';

    expect(() => encodeURIComponent(malformed)).toThrow(URIError);
    expect(() => safeEncodeURIComponent(malformed)).not.toThrow();
    expect(safeEncodeURIComponent(malformed)).toContain('%EF%BF%BD');
  });

  it('builds workflow text thumbnails for malformed text assets', () => {
    const url = buildComposerTextAssetThumbDataUrl('title \uD800', 'body \uDC00');

    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(url).toContain('%EF%BF%BD');
  });

  it('builds generic SVG data URLs for malformed text', () => {
    const url = safeSvgDataUrl('<svg><text>\uD800</text></svg>');

    expect(url).toContain('%EF%BF%BD');
  });
});
