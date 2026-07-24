import { describe, expect, it } from 'vitest';
import {
  buildOpenAiCompatibleRuntimeRoutes,
  defaultOpenAiCompatibleBaseUrl,
  isOpenAiCompatibleAdapterId,
  normalizeOpenAiCompatibleBaseUrl,
  openAiCompatibleAdapterIdsForModality,
  openAiCompatibleChannelForProvider,
  openAiCompatibleConfigForProvider,
  openAiCompatibleProviderLabel,
} from '../server/ai-gateway/openai-compatible-config.js';

describe('OpenAI-compatible provider config', () => {
  it('registers aggregate gateways and adapter ids from one config table', () => {
    expect(openAiCompatibleConfigForProvider('302ai')).toMatchObject({
      label: '302.AI',
      defaultBaseUrl: 'https://api.302.ai/v1',
      adapterIds: ['302ai-openai'],
    });
    expect(isOpenAiCompatibleAdapterId('302ai-openai')).toBe(true);
    expect(openAiCompatibleProviderLabel('302ai')).toBe('302.AI');
    expect(openAiCompatibleConfigForProvider('aihubmix')).toMatchObject({
      label: 'AIHubMix',
      defaultBaseUrl: 'https://aihubmix.com/v1',
      adapterIds: ['aihubmix-openai'],
    });
    expect(isOpenAiCompatibleAdapterId('aihubmix-openai')).toBe(true);
    expect(openAiCompatibleProviderLabel('aihubmix')).toBe('AIHubMix');
  });

  it('normalizes /v1 for OpenAI-compatible aggregators but not Ark api/v3', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('https://gateway.example', '302ai')).toBe('https://gateway.example/v1');
    expect(normalizeOpenAiCompatibleBaseUrl('https://gateway.example/v1', '302ai')).toBe('https://gateway.example/v1');
    expect(normalizeOpenAiCompatibleBaseUrl('https://aihubmix.example', 'aihubmix')).toBe('https://aihubmix.example/v1');
    expect(normalizeOpenAiCompatibleBaseUrl('https://aihubmix.example/v1', 'aihubmix')).toBe('https://aihubmix.example/v1');
    expect(normalizeOpenAiCompatibleBaseUrl('https://ark.example/api/v3/', 'volcengine-ark')).toBe('https://ark.example/api/v3');
  });

  it('keeps default base URLs centralized for smoke tests and adapters', () => {
    expect(defaultOpenAiCompatibleBaseUrl('302ai')).toBe('https://api.302.ai/v1');
    expect(defaultOpenAiCompatibleBaseUrl('aihubmix')).toBe('https://aihubmix.com/v1');
    expect(defaultOpenAiCompatibleBaseUrl('missing-provider')).toBe('https://api.openai.com/v1');
    expect(openAiCompatibleChannelForProvider('aihubmix')).toBe('aihubmix-openai');
    expect(openAiCompatibleChannelForProvider('volcengine-ark')).toBe('volcengine-ark');
    expect(openAiCompatibleChannelForProvider('missing-provider')).toBe('');
  });

  it('derives worker adapters and runtime routes from the compatible provider table', () => {
    expect(openAiCompatibleAdapterIdsForModality('text')).toEqual(
      expect.arrayContaining([
        'openai-official',
        'toapis-openai',
        '302ai-openai',
        'aihubmix-openai',
        'tinysnow-openai',
        'volcengine-ark-openai',
      ])
    );
    expect(openAiCompatibleAdapterIdsForModality('text')).toHaveLength(6);
    expect(openAiCompatibleAdapterIdsForModality('image')).toEqual(
      expect.arrayContaining([
        'openai-official',
        'toapis-openai',
        '302ai-openai',
        'aihubmix-openai',
        'tinysnow-openai',
        'volcengine-ark-image',
      ])
    );
    expect(openAiCompatibleAdapterIdsForModality('image')).toHaveLength(6);
    expect(buildOpenAiCompatibleRuntimeRoutes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'aihubmix',
          workerId: 'text-worker',
          adapterId: 'aihubmix-openai',
          channel: 'aihubmix-openai',
          priority: 43,
        }),
        expect.objectContaining({
          providerId: 'aihubmix',
          workerId: 'image-worker',
          adapterId: 'aihubmix-openai',
          channel: 'aihubmix-openai',
          priority: 43,
        }),
      ])
    );
  });
});
