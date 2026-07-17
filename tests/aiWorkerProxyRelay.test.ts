import { describe, expect, it } from 'vitest';
import { aiWorkerProxyUpstreamBase, aiWorkerProxyUpstreamDiagnostics } from '../server/ai-worker-proxy-relay.js';

const ENV_KEYS = [
  'AI_WORKER_PROXY_UPSTREAM_URL',
  'AI_WORKER_PROXY_HEALTH_URL',
  'AI_WORKER_PROXY_BASE_URL',
  'GEMINI_PROXY_UPSTREAM_URL',
  'GEMINI_PROXY_HEALTH_URL',
  'GEMINI_PROXY_BASE_URL',
] as const;

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('ai-worker-proxy-relay', () => {
  it('defaults upstream to local ai-worker-proxy when env unset', () => {
    const prev = snapshotEnv();
    clearEnv();
    expect(aiWorkerProxyUpstreamBase()).toBe('http://127.0.0.1:9002');
    restoreEnv(prev);
  });

  it('uses production default upstream when NODE_ENV=production and env unset', () => {
    const prevNode = process.env.NODE_ENV;
    const prev = snapshotEnv();
    process.env.NODE_ENV = 'production';
    clearEnv();
    expect(aiWorkerProxyUpstreamBase()).toBe('https://assetcutter-ai-worker-proxy.onrender.com');
    if (prevNode !== undefined) process.env.NODE_ENV = prevNode;
    else delete process.env.NODE_ENV;
    restoreEnv(prev);
  });

  it('prefers AI_WORKER_PROXY_UPSTREAM_URL over health url', () => {
    const prev = snapshotEnv();
    clearEnv();
    process.env.AI_WORKER_PROXY_UPSTREAM_URL = 'https://worker.example/';
    process.env.AI_WORKER_PROXY_HEALTH_URL = 'https://health.example';
    expect(aiWorkerProxyUpstreamBase()).toBe('https://worker.example');
    restoreEnv(prev);
  });

  it('keeps legacy GEMINI_PROXY_UPSTREAM_URL as migration fallback', () => {
    const prev = snapshotEnv();
    clearEnv();
    process.env.GEMINI_PROXY_UPSTREAM_URL = 'https://legacy-worker.example/';
    expect(aiWorkerProxyUpstreamBase()).toBe('https://legacy-worker.example');
    expect(aiWorkerProxyUpstreamDiagnostics()).toMatchObject({
      origin: 'https://legacy-worker.example',
      source: 'GEMINI_PROXY_UPSTREAM_URL',
      legacyGeminiProxyEnvUsed: true,
      legacyGeminiProxyEnvPresent: true,
    });
    restoreEnv(prev);
  });

  it('reports new ai-worker-proxy env as non-legacy diagnostics', () => {
    const prev = snapshotEnv();
    clearEnv();
    process.env.AI_WORKER_PROXY_UPSTREAM_URL = 'https://worker.example/';
    process.env.GEMINI_PROXY_BASE_URL = 'https://legacy-worker.example/';
    expect(aiWorkerProxyUpstreamDiagnostics()).toMatchObject({
      origin: 'https://worker.example',
      source: 'AI_WORKER_PROXY_UPSTREAM_URL',
      legacyGeminiProxyEnvUsed: false,
      legacyGeminiProxyEnvPresent: true,
    });
    restoreEnv(prev);
  });
});
