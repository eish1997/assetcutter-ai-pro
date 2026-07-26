import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/generation/runUnifiedGeneration', async () => {
  const actual = await vi.importActual<typeof import('../services/generation/runUnifiedGeneration')>(
    '../services/generation/runUnifiedGeneration'
  );
  return {
    ...actual,
    runUnifiedContentsTextGeneration: vi.fn(),
  };
});

vi.mock('../services/aiDispatchGate', () => ({
  gateBeforeUpstream: vi.fn(async () => ({
    billingDecision: { routeKind: 'platform', platformReserve: { estimatedCredits: 3 } },
  })),
}));

vi.mock('../services/creditsProxyBridge', () => ({
  markCreditsProxyHeadersFromGate: vi.fn(),
  getCachedCreditsProxyHeaders: vi.fn(() => null),
  clearLastCreditsReserveKey: vi.fn(),
}));

import { runUnifiedContentsTextGeneration } from '../services/generation/runUnifiedGeneration';
import {
  generateArenaABPrompts,
  generateArenaPrompts,
  generateNewChallenger,
  optimizeLoserPrompt,
  translateToChinese,
} from '../services/unifiedAiGateway';

describe('prompt arena Gateway path', () => {
  beforeEach(() => {
    vi.mocked(runUnifiedContentsTextGeneration).mockReset();
  });

  it('generateArenaABPrompts uses Gateway text jobs (no Vertex sync proxy)', async () => {
    vi.mocked(runUnifiedContentsTextGeneration).mockResolvedValue(
      JSON.stringify({ promptA: 'edit A', promptB: 'edit B', reasoning: 'why' })
    );
    await expect(generateArenaABPrompts('make it clay', 'gemini-3-flash-preview')).resolves.toMatchObject({
      promptA: 'edit A',
      promptB: 'edit B',
    });
    expect(runUnifiedContentsTextGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        uiSource: 'unifiedAiGateway.generateArenaABPrompts',
        model: 'gemini-3-flash-preview',
      })
    );
  });

  it('generateArenaPrompts / optimizeLoser / newChallenger / translate all use Gateway', async () => {
    vi.mocked(runUnifiedContentsTextGeneration)
      .mockResolvedValueOnce(
        JSON.stringify({ promptA: 'a', promptB: 'b', promptC: 'c' })
      )
      .mockResolvedValueOnce(JSON.stringify({ prompt: 'improved', reasoning: 'r' }))
      .mockResolvedValueOnce(JSON.stringify({ prompt: 'challenger' }))
      .mockResolvedValueOnce('中文译文');

    await generateArenaPrompts('desc', 3, 'gemini-3-flash-preview');
    await optimizeLoserPrompt('win', 'lose', 'intent', 'gemini-3-flash-preview');
    await generateNewChallenger('intent', 'champ', ['old'], 'gemini-3-flash-preview');
    await expect(translateToChinese('hello', 'gemini-3-flash-preview')).resolves.toBe('中文译文');

    const sources = vi.mocked(runUnifiedContentsTextGeneration).mock.calls.map(
      (call) => (call[0] as { uiSource?: string }).uiSource
    );
    expect(sources).toEqual([
      'unifiedAiGateway.generateArenaPrompts',
      'unifiedAiGateway.optimizeLoserPrompt',
      'unifiedAiGateway.generateNewChallenger',
      'unifiedAiGateway.translateToChinese',
    ]);
  });
});
