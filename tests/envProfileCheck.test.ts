import { describe, expect, it } from 'vitest';
import { evaluateProfile } from '../scripts/env-profile-check.mjs';

describe('env-profile-check (C1)', () => {
  it('dev allows plan + disk with warnings only', () => {
    const r = evaluateProfile(
      {
        AI_GATEWAY_CREDITS_GATE: 'plan',
        VITE_AI_WORKER_PROXY_API: 'https://assetcutter-ai-worker-proxy.onrender.com',
      },
      'dev'
    );
    expect(r.fails).toEqual([]);
    expect(r.warns.some((w) => w.includes('topology mismatch'))).toBe(true);
    expect(r.warns.some((w) => w.includes('DATABASE_URL'))).toBe(true);
  });

  it('prod-like fails on false-green switches and plan credits', () => {
    const r = evaluateProfile(
      {
        AI_GATEWAY_CREDITS_GATE: 'plan',
        DATABASE_URL: 'postgres://x',
        GEMINI_FAIRNESS_ENABLED: 'true',
        GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS: '65000',
        VITE_USE_BROWSER_GEMINI_KEY_FIRST: 'true',
        VITE_AUTH_API_BASE_URL: 'https://assetcutter-auth-api.onrender.com',
        VITE_AI_WORKER_PROXY_API: 'https://assetcutter-ai-worker-proxy.onrender.com',
      },
      'prod-like'
    );
    expect(r.fails.some((f) => f.includes('BROWSER_GEMINI_KEY_FIRST'))).toBe(true);
    expect(r.fails.some((f) => f.includes('CREDITS_GATE'))).toBe(true);
  });

  it('prod-like passes aligned cloud world without local fairness env (C13 cloud path)', () => {
    const r = evaluateProfile(
      {
        AI_GATEWAY_CREDITS_GATE: 'reserve',
        AI_GATEWAY_CREDITS_GATE_STRICT: 'true',
        AI_GATEWAY_EXECUTION_ENABLED: 'true',
        DATABASE_URL: 'postgres://x',
        VITE_AUTH_API_BASE_URL: 'https://assetcutter-auth-api.onrender.com',
        VITE_AI_WORKER_PROXY_API: 'https://assetcutter-ai-worker-proxy.onrender.com',
        R2_BUCKET: 'assetcutter',
      },
      'prod-like'
    );
    expect(r.fails).toEqual([]);
    expect(r.infos.some((i) => i.includes('fairness + Vertex interval'))).toBe(true);
  });

  it('D4: prod-like fails when MODEL3D execution disabled', () => {
    const r = evaluateProfile(
      {
        AI_GATEWAY_CREDITS_GATE: 'reserve',
        AI_GATEWAY_CREDITS_GATE_STRICT: 'true',
        DATABASE_URL: 'postgres://x',
        VITE_AUTH_API_BASE_URL: 'https://assetcutter-auth-api.onrender.com',
        VITE_AI_WORKER_PROXY_API: 'https://assetcutter-ai-worker-proxy.onrender.com',
        VITE_AI_GATEWAY_MODEL3D_EXECUTION: 'false',
        R2_BUCKET: 'assetcutter',
      },
      'prod-like'
    );
    expect(r.fails.some((f) => f.includes('MODEL3D_EXECUTION'))).toBe(true);
  });

  it('D2: prod-like fails when CREDITS_GATE_STRICT unset', () => {
    const r = evaluateProfile(
      {
        AI_GATEWAY_CREDITS_GATE: 'reserve',
        DATABASE_URL: 'postgres://x',
        VITE_AUTH_API_BASE_URL: 'https://assetcutter-auth-api.onrender.com',
        VITE_AI_WORKER_PROXY_API: 'https://assetcutter-ai-worker-proxy.onrender.com',
        R2_BUCKET: 'assetcutter',
      },
      'prod-like'
    );
    expect(r.fails.some((f) => f.includes('CREDITS_GATE_STRICT'))).toBe(true);
  });

  it('prod-like local proxy requires fairness + 65s interval (C13)', () => {
    const r = evaluateProfile(
      {
        AI_GATEWAY_CREDITS_GATE: 'reserve',
        DATABASE_URL: 'postgres://x',
        VITE_AUTH_API_BASE_URL: 'http://127.0.0.1:9100',
        VITE_AI_WORKER_PROXY_API: 'http://127.0.0.1:9002',
      },
      'prod-like'
    );
    expect(r.fails.some((f) => f.includes('GEMINI_FAIRNESS_ENABLED'))).toBe(true);
    expect(r.fails.some((f) => f.includes('GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS'))).toBe(true);
  });

  it('prod-like rejects same-origin proxy', () => {
    const r = evaluateProfile(
      {
        AI_GATEWAY_CREDITS_GATE: 'reserve',
        DATABASE_URL: 'postgres://x',
        GEMINI_FAIRNESS_ENABLED: 'true',
        GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS: '65000',
        VITE_AUTH_API_BASE_URL: 'https://assetcutter-auth-api.onrender.com',
        VITE_AI_WORKER_PROXY_API: 'same-origin',
      },
      'prod-like'
    );
    expect(r.fails.some((f) => f.includes('same-origin'))).toBe(true);
  });

  it('C9: VITE_TENCENT_PROXY is warn in dev and fail in prod-like', () => {
    const dev = evaluateProfile({ VITE_TENCENT_PROXY: 'http://127.0.0.1:9001' }, 'dev');
    expect(dev.fails).toEqual([]);
    expect(dev.warns.some((w) => w.includes('VITE_TENCENT_PROXY'))).toBe(true);

    const prod = evaluateProfile(
      {
        AI_GATEWAY_CREDITS_GATE: 'reserve',
        AI_GATEWAY_CREDITS_GATE_STRICT: 'true',
        DATABASE_URL: 'postgres://x',
        VITE_AUTH_API_BASE_URL: 'https://assetcutter-auth-api.onrender.com',
        VITE_AI_WORKER_PROXY_API: 'https://assetcutter-ai-worker-proxy.onrender.com',
        VITE_TENCENT_PROXY: 'http://127.0.0.1:9001',
      },
      'prod-like'
    );
    expect(prod.fails.some((f) => f.includes('VITE_TENCENT_PROXY'))).toBe(true);
  });
});
