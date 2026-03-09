import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getTencentCredsFromEnv,
  isUnsafeTencentBrowserModeEnabled,
  startTencent3DRapidJob,
} from '../services/tencentService';
import { setTencentSecretId, setTencentSecretKey } from '../services/settingsStore';

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

const originalProxy = process.env.VITE_TENCENT_PROXY;
const originalUnsafe = process.env.VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS;
const originalFetch = globalThis.fetch;

function createAbortAwarePendingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const rejectAbort = () => {
      const reason = signal?.reason;
      const error = reason instanceof Error ? reason : new Error('This operation was aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) {
      rejectAbort();
      return;
    }
    signal?.addEventListener('abort', rejectAbort, { once: true });
  }));
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
  process.env.VITE_TENCENT_PROXY = '';
  process.env.VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS = '';
});

afterEach(() => {
  process.env.VITE_TENCENT_PROXY = originalProxy ?? '';
  process.env.VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS = originalUnsafe ?? '';
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('tencentService credentials boundary', () => {
  it('优先返回代理配置而不把密钥暴露给前端调用层', () => {
    process.env.VITE_TENCENT_PROXY = 'http://127.0.0.1:9001';

    expect(getTencentCredsFromEnv()).toEqual({
      secretId: '',
      secretKey: '',
      proxyUrl: 'http://127.0.0.1:9001',
    });
  });

  it('默认不允许浏览器直持腾讯云密钥', () => {
    setTencentSecretId('id');
    setTencentSecretKey('key');

    expect(isUnsafeTencentBrowserModeEnabled()).toBe(false);
    expect(getTencentCredsFromEnv()).toBeNull();
  });

  it('显式开启后才允许浏览器直持腾讯云密钥', () => {
    process.env.VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS = 'true';
    setTencentSecretId('id');
    setTencentSecretKey('key');

    expect(isUnsafeTencentBrowserModeEnabled()).toBe(true);
    expect(getTencentCredsFromEnv()).toEqual({
      secretId: 'id',
      secretKey: 'key',
    });
  });
});

describe('tencentService request guardrails', () => {
  it('代理请求挂起时会按超时中断', async () => {
    globalThis.fetch = createAbortAwarePendingFetch() as typeof fetch;

    await expect(startTencent3DRapidJob(
      { prompt: '生成一个小机器人' },
      { secretId: '', secretKey: '', proxyUrl: 'http://127.0.0.1:9001' },
      () => {},
      undefined,
      { timeoutMs: 20 }
    )).rejects.toThrow('请求超时');
  });

  it('外部 signal 可以在轮询等待阶段立刻取消任务', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ Response: { JobId: 'job-1' } }),
    } satisfies Pick<Response, 'json'> as Response);
    globalThis.fetch = fetchMock as typeof fetch;
    const controller = new AbortController();

    const jobPromise = startTencent3DRapidJob(
      { prompt: '生成一个小机器人' },
      { secretId: '', secretKey: '', proxyUrl: 'http://127.0.0.1:9001' },
      () => {},
      undefined,
      { signal: controller.signal, timeoutMs: 1000 }
    );

    controller.abort();

    await expect(jobPromise).rejects.toThrow('请求已取消');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
