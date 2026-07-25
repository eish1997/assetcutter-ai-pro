import { describe, expect, it } from 'vitest';
import { evaluateAiEnvTopology, hostKind } from '../services/aiEnvTopology';

describe('aiEnvTopology (C5)', () => {
  it('classifies hosts', () => {
    expect(hostKind('same-origin')).toBe('same-origin');
    expect(hostKind('http://127.0.0.1:9100')).toBe('local');
    expect(hostKind('https://assetcutter-ai-worker-proxy.onrender.com')).toBe('cloud');
  });

  it('flags local auth + cloud proxy', () => {
    const r = evaluateAiEnvTopology({
      authBaseUrl: '',
      proxyApi: 'https://assetcutter-ai-worker-proxy.onrender.com',
      assumeEmptyAuthIsLocal: true,
    });
    expect(r.ok).toBe(false);
    expect(r.issue?.code).toBe('local_auth_cloud_proxy');
    expect(r.issue?.messageZh).toContain('勿当作预发');
  });

  it('flags cloud auth + same-origin proxy', () => {
    const r = evaluateAiEnvTopology({
      authBaseUrl: 'https://assetcutter-auth-api.onrender.com',
      proxyApi: 'same-origin',
    });
    expect(r.ok).toBe(false);
    expect(r.issue?.code).toBe('cloud_auth_local_proxy');
  });

  it('ok when both cloud', () => {
    const r = evaluateAiEnvTopology({
      authBaseUrl: 'https://assetcutter-auth-api.onrender.com',
      proxyApi: 'https://assetcutter-ai-worker-proxy.onrender.com',
    });
    expect(r.ok).toBe(true);
    expect(r.issue).toBeNull();
  });
});
