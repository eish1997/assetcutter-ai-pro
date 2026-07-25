import { describe, expect, it } from 'vitest';
import {
  extractPublishedAllowlist,
  redactProviderKeysPayload,
  summarizeKeyGap,
} from '../scripts/admin-pull-online-config.mjs';

describe('admin-pull-online-config (C2)', () => {
  it('redacts secrets from provider keys payload', () => {
    const mirror = redactProviderKeysPayload({
      keys: [
        {
          id: 'k1',
          provider: '302ai',
          label: '302',
          enabled: true,
          secret: 'SHOULD_NOT_APPEAR',
          hasSecret: true,
          secretPreview: 'sk-***',
          credentials: { apiKey: 'SECRET', baseUrl: 'https://example.com' },
          runtime: { healthStatus: 'ok' },
        },
      ],
    });
    const json = JSON.stringify(mirror);
    expect(json).not.toContain('SHOULD_NOT_APPEAR');
    expect(json).not.toContain('SECRET');
    expect(mirror.keys[0].hasSecret).toBe(true);
    expect(mirror.keys[0].baseUrl).toBe('https://example.com');
  });

  it('reports online providers missing on local disk', () => {
    const mirror = redactProviderKeysPayload({
      keys: [
        { id: 'a', provider: '302ai', label: '302', hasSecret: true, enabled: true },
        { id: 'b', provider: 'tripo', label: 'Tripo', hasSecret: true, enabled: true },
      ],
    });
    const gap = summarizeKeyGap(mirror, { keys: [{ provider: '302ai', secret: 'x' }] });
    expect(gap.missingLocally.map((m) => m.provider)).toEqual(['tripo']);
  });

  it('extracts published allowlist', () => {
    expect(
      extractPublishedAllowlist({
        config: { publishedCanonicalModelAllowlist: ['gpt-4o-mini', 'gpt-image-1.5'] },
      })
    ).toEqual(['gpt-4o-mini', 'gpt-image-1.5']);
  });
});
