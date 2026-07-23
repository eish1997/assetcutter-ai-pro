import { describe, expect, it } from 'vitest';

import {
  normalizeInlineBase64Data,
  normalizeInlineDataPayload,
} from '../server/ai-gateway/inline-data-normalize.js';

describe('AI gateway inline data normalization', () => {
  it('strips data URL prefixes and whitespace from inline image bytes', () => {
    expect(normalizeInlineBase64Data('data:image/png;base64, QUJD\nRA== ')).toBe('QUJDRA==');
  });

  it('normalizes nested Gemini inlineData payloads defensively', () => {
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'edit this' },
            { inlineData: { mimeType: 'image/png', data: 'data:image/png;base64, QUJD\nRA== ' } },
            { inline_data: { mime_type: 'image/jpeg', data: 'data:image/jpeg;base64, /9j/AA== ' } },
          ],
        },
      ],
    };

    expect(normalizeInlineDataPayload(payload)).toMatchObject({
      contents: [
        {
          parts: [
            { text: 'edit this' },
            { inlineData: { mimeType: 'image/png', data: 'QUJDRA==' } },
            { inline_data: { mime_type: 'image/jpeg', data: '/9j/AA==' } },
          ],
        },
      ],
    });
  });
});
