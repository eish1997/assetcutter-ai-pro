import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/generation/runUnifiedGeneration', () => ({
  runUnifiedTextGeneration: vi.fn(),
}));

import { runUnifiedTextGeneration } from '../services/generation/runUnifiedGeneration';
import { runStoryboardGatewayText } from '../services/storyboardGatewayText';

describe('runStoryboardGatewayText', () => {
  afterEach(() => {
    vi.mocked(runUnifiedTextGeneration).mockReset();
  });

  it('routes storyboard text tasks through unified text generation with trace metadata', async () => {
    vi.mocked(runUnifiedTextGeneration).mockResolvedValueOnce('{"rows":[]}');

    await expect(
      runStoryboardGatewayText({
        prompt: 'parse storyboard',
        model: 'doubao-seed-2-0-pro',
        ctx: {
          storyboardAssetId: 'storyboard_asset_1',
          companionProjectId: 'project_1',
        },
        operation: 'parse_bulk',
        presetId: 'storyboard_parse_structured_v1',
        presetLabel: 'Storyboard Parse',
        requestOptions: { responseMimeType: 'application/json', timeoutMs: 300000 },
      })
    ).resolves.toBe('{"rows":[]}');

    expect(runUnifiedTextGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'parse storyboard',
        model: 'doubao-seed-2-0-pro',
        uiSource: 'storyboard.parse_bulk',
        assetContext: {
          projectId: 'project_1',
          sourceAssetId: 'storyboard_asset_1',
        },
        metadata: expect.objectContaining({
          storyboard: true,
          operation: 'parse_bulk',
          storyboardAssetId: 'storyboard_asset_1',
          presetId: 'storyboard_parse_structured_v1',
          presetLabel: 'Storyboard Parse',
          requestOptions: { responseMimeType: 'application/json', timeoutMs: 300000 },
        }),
      })
    );
  });
});
