import { describe, expect, it } from 'vitest';

import { normalizeAiGatewayOpsControlConfig } from '../server/ai-gateway/ops-control.js';

describe('AI Gateway ops control config', () => {
  it('normalizes provider/model pauses and model overrides', () => {
    expect(
      normalizeAiGatewayOpsControlConfig({
        disabledProviders: ['vertex-gemini', 'vertex-gemini', '', null],
        disabledModels: ['gemini-pro', '  gemini-pro  ', 'gemini-flash'],
        modelOverrides: [
          { from: 'gemini-pro', to: 'gemini-flash', reason: 'quota' },
          { from: '', to: 'ignored' },
          { from: 'disabled-old', to: 'disabled-new', enabled: false },
        ],
      })
    ).toEqual({
      disabledProviders: ['vertex-gemini'],
      disabledModels: ['gemini-pro', 'gemini-flash'],
      modelOverrides: [
        { from: 'gemini-pro', to: 'gemini-flash', enabled: true, reason: 'quota' },
        { from: 'disabled-old', to: 'disabled-new', enabled: false, reason: null },
      ],
    });
  });
});
