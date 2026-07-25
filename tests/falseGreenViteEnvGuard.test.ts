import { describe, expect, it } from 'vitest';
import { evaluateFalseGreenViteEnv } from '../scripts/check-false-green-vite-env.mjs';

describe('check-false-green-vite-env (C4)', () => {
  it('development skips hard fails', () => {
    const r = evaluateFalseGreenViteEnv(
      { VITE_OPENAI_DIRECT: 'true', VITE_AI_WORKER_PROXY_API: 'same-origin' },
      'development'
    );
    expect(r.fails).toEqual([]);
  });

  it('production rejects DIRECT / Key First / same-origin / unsafe tencent', () => {
    const r = evaluateFalseGreenViteEnv(
      {
        VITE_USE_BROWSER_GEMINI_KEY_FIRST: 'true',
        VITE_OPENAI_DIRECT: '1',
        VITE_VECTOR_ENGINE_DIRECT: 'yes',
        VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS: 'true',
        VITE_AI_WORKER_PROXY_API: 'same-origin',
        VITE_AI_WORKER_PROXY_API_VERTEX: 'same-origin',
      },
      'production'
    );
    expect(r.fails.length).toBeGreaterThanOrEqual(5);
  });

  it('production allows clean cloud proxy URLs', () => {
    const r = evaluateFalseGreenViteEnv(
      {
        VITE_AI_WORKER_PROXY_API: 'https://assetcutter-ai-worker-proxy.onrender.com',
        VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS: 'false',
      },
      'production'
    );
    expect(r.fails).toEqual([]);
  });

  it('D4: production rejects MODEL3D off and VITE_TENCENT_PROXY', () => {
    const r = evaluateFalseGreenViteEnv(
      {
        VITE_AI_GATEWAY_MODEL3D_EXECUTION: 'false',
        VITE_TENCENT_PROXY: 'http://127.0.0.1:9001',
      },
      'production'
    );
    expect(r.fails.some((f) => f.includes('MODEL3D_EXECUTION'))).toBe(true);
    expect(r.fails.some((f) => f.includes('VITE_TENCENT_PROXY'))).toBe(true);
  });
});
