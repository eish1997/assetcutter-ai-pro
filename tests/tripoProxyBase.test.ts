import { afterEach, describe, expect, it } from 'vitest';
import { apiUrl } from '../services/apiBase';
import { resolveTripoProxyBase } from '../services/tripoService';

describe('resolveTripoProxyBase', () => {
  const originalAuthBase = import.meta.env.VITE_AUTH_API_BASE_URL;

  afterEach(() => {
    import.meta.env.VITE_AUTH_API_BASE_URL = originalAuthBase;
  });

  it('未配置 VITE_AUTH_API_BASE_URL 时走同源 /api/tripo', () => {
    import.meta.env.VITE_AUTH_API_BASE_URL = '';
    expect(resolveTripoProxyBase()).toBe('/api/tripo');
    expect(`${resolveTripoProxyBase()}/fetch-file`).toBe('/api/tripo/fetch-file');
  });

  it('配置 VITE_AUTH_API_BASE_URL 时 fetch-file 指向 auth-api 绝对地址', () => {
    import.meta.env.VITE_AUTH_API_BASE_URL = 'https://auth.example.com/';
    expect(resolveTripoProxyBase()).toBe('https://auth.example.com/api/tripo');
    expect(apiUrl('/api/tripo/fetch-file')).toBe('https://auth.example.com/api/tripo/fetch-file');
  });
});
