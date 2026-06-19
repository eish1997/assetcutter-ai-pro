import { describe, expect, it } from 'vitest';
import {
  extractUsageMetadata,
  extractUsageMetadataFromProxyResult,
} from '../shared/extractUsageMetadata.js';

describe('extractUsageMetadata', () => {
  it('extracts nested usageMetadata', () => {
    const um = extractUsageMetadata({
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    });
    expect(um).toEqual({ promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 });
  });

  it('extracts OpenAI-style usage on ToAPIs chat payload', () => {
    const um = extractUsageMetadata({
      usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
    });
    expect(um).toEqual({ promptTokenCount: 120, candidatesTokenCount: 40, totalTokenCount: 160 });
  });

  it('extracts from proxy async result wrapper', () => {
    const um = extractUsageMetadataFromProxyResult({
      text: 'hi',
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
    });
    expect(um?.totalTokenCount).toBe(5);
  });

  it('returns null when empty', () => {
    expect(extractUsageMetadata({})).toBeNull();
  });
});
