import { describe, expect, it } from 'vitest';
import { normalizeStoryboardGridExportWidth } from '../services/storyboardGridExport';

describe('storyboardGridExport', () => {
  it('normalizes export width', () => {
    expect(normalizeStoryboardGridExportWidth(0)).toBe(2560);
    expect(normalizeStoryboardGridExportWidth(1920)).toBe(1920);
    expect(normalizeStoryboardGridExportWidth(99999)).toBe(8192);
  });
});
