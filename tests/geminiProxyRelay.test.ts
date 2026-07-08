import { describe, expect, it } from 'vitest';
import { geminiProxyUpstreamBase } from '../server/gemini-proxy-relay.js';

describe('gemini-proxy-relay', () => {
  it('defaults upstream to local gemini-proxy when env unset', () => {
    const prev = process.env.GEMINI_PROXY_UPSTREAM_URL;
    const prevHealth = process.env.GEMINI_PROXY_HEALTH_URL;
    delete process.env.GEMINI_PROXY_UPSTREAM_URL;
    delete process.env.GEMINI_PROXY_HEALTH_URL;
    expect(geminiProxyUpstreamBase()).toBe('http://127.0.0.1:9002');
    if (prev !== undefined) process.env.GEMINI_PROXY_UPSTREAM_URL = prev;
    if (prevHealth !== undefined) process.env.GEMINI_PROXY_HEALTH_URL = prevHealth;
  });

  it('prefers GEMINI_PROXY_UPSTREAM_URL over health url', () => {
    const prev = process.env.GEMINI_PROXY_UPSTREAM_URL;
    const prevHealth = process.env.GEMINI_PROXY_HEALTH_URL;
    process.env.GEMINI_PROXY_UPSTREAM_URL = 'https://proxy.example/';
    process.env.GEMINI_PROXY_HEALTH_URL = 'https://health.example';
    expect(geminiProxyUpstreamBase()).toBe('https://proxy.example');
    if (prev !== undefined) process.env.GEMINI_PROXY_UPSTREAM_URL = prev;
    else delete process.env.GEMINI_PROXY_UPSTREAM_URL;
    if (prevHealth !== undefined) process.env.GEMINI_PROXY_HEALTH_URL = prevHealth;
    else delete process.env.GEMINI_PROXY_HEALTH_URL;
  });
});
