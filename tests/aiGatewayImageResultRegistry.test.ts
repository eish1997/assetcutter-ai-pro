import { afterEach, describe, expect, it } from 'vitest';

import {
  aiGatewayImageResultKey,
  clearAiGatewayImageResultRegistryForTest,
  consumeAiGatewayJobIdForImage,
  rememberAiGatewayImageResult,
} from '../services/aiGatewayImageResultRegistry';

describe('aiGatewayImageResultRegistry', () => {
  afterEach(() => {
    clearAiGatewayImageResultRegistryForTest();
  });

  it('binds an inline image result to a gateway job id once', () => {
    const image = 'data:image/png;base64,abc123';
    rememberAiGatewayImageResult(image, 'aijob_1');

    expect(consumeAiGatewayJobIdForImage(image)).toBe('aijob_1');
    expect(consumeAiGatewayJobIdForImage(image)).toBeNull();
  });

  it('does not retain raw data urls in the lookup key', () => {
    const image = 'data:image/png;base64,' + 'x'.repeat(200);

    expect(aiGatewayImageResultKey(image)).not.toContain('base64');
    expect(aiGatewayImageResultKey(image)).not.toContain('x'.repeat(20));
  });

  it('ignores non-image results and empty job ids', () => {
    rememberAiGatewayImageResult('data:text/plain;base64,abc', 'aijob_text');
    rememberAiGatewayImageResult('data:image/png;base64,abc', '');

    expect(consumeAiGatewayJobIdForImage('data:text/plain;base64,abc')).toBeNull();
    expect(consumeAiGatewayJobIdForImage('data:image/png;base64,abc')).toBeNull();
  });
});
