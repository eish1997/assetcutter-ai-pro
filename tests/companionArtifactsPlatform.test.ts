import { describe, expect, it } from 'vitest';
import {
  platformMatchesQuery,
  platformRankForLatest,
} from '../server/companion-artifacts-platform.js';

describe('companion-artifacts-platform', () => {
  it('platformMatchesQuery: universal matches all', () => {
    expect(platformMatchesQuery('win32', 'universal')).toBe(true);
    expect(platformMatchesQuery('darwin', 'all')).toBe(true);
    expect(platformMatchesQuery('linux', 'UNIVERSAL')).toBe(true);
  });

  it('platformMatchesQuery: exact match', () => {
    expect(platformMatchesQuery('win32', 'win32')).toBe(true);
    expect(platformMatchesQuery('win32', 'darwin')).toBe(false);
  });

  it('platformRankForLatest: exact before universal when sorting ascending by rank', () => {
    expect(platformRankForLatest('win32', 'win32')).toBe(0);
    expect(platformRankForLatest('win32', 'universal')).toBe(1);
    expect(platformRankForLatest('win32', 'all')).toBe(1);
  });
});
