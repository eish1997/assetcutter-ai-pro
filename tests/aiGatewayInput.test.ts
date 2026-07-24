import { describe, expect, it } from 'vitest';

import {
  normalizeGatewayInput,
  promptFromGatewayInput,
  referenceImagesFromGatewayInput,
} from '../server/ai-gateway/gateway-input.js';

describe('AI gateway standard input helpers', () => {
  it('extracts prompt and reference images from provider-neutral contents', () => {
    const input = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'make a turntable model' },
            { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
            { imageUrl: 'https://cdn.example/ref.png' },
          ],
        },
      ],
      referenceImages: ['https://cdn.example/ref.png'],
    };

    expect(promptFromGatewayInput(input)).toBe('make a turntable model');
    expect(referenceImagesFromGatewayInput(input)).toEqual([
      'https://cdn.example/ref.png',
      'data:image/png;base64,AAAA',
    ]);
  });

  it('normalizes video and 3D controls without dropping legacy aliases', () => {
    expect(
      normalizeGatewayInput({
        modality: 'video',
        input: {
          prompt: 'short product clip',
          duration: 5,
          ratio: '16:9',
          resolution: '1080p',
          seed: '42',
        },
      })
    ).toMatchObject({
      modality: 'video',
      prompt: 'short product clip',
      durationSeconds: 5,
      aspectRatio: '16:9',
      resolution: '1080p',
      seed: 42,
    });

    expect(
      normalizeGatewayInput({
        modality: 'model3d',
        input: {
          text: 'small robot',
          format: 'glb',
          quality: 'high',
          texture: true,
        },
      })
    ).toMatchObject({
      modality: 'model3d',
      prompt: 'small robot',
      format: 'glb',
      quality: 'high',
      texture: true,
    });
  });
});
