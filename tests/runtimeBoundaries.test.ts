import { afterEach, describe, expect, it, vi } from 'vitest';

import { seamRepair, normalizeSeamRepairParams } from '../services/seamRepairService';
import { withGeminiRequestControl } from '../services/unifiedAiGateway';

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

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('runtime boundary helpers', () => {
  it('Gemini 统一请求控制会在超时后终止挂起请求', async () => {
    await expect(withGeminiRequestControl(
      async () => new Promise<string>(() => {}),
      { timeoutMs: 20, retries: 0 }
    )).rejects.toThrow('请求超时');
  });

  it('Gemini 统一请求控制会响应外部取消信号', async () => {
    const controller = new AbortController();
    const promise = withGeminiRequestControl(
      async () => new Promise<string>(() => {}),
      { abortSignal: controller.signal, timeoutMs: 1000, retries: 0 }
    );
    controller.abort();
    await expect(promise).rejects.toThrow('请求已取消');
  });

  it('浏览器内 seam repair 参数会先收敛到允许范围', () => {
    expect(normalizeSeamRepairParams({
      texture_kind: 'weird',
      band_px: 999,
      feather_px: -5,
      sample_step_px: 0.01,
      mode: 'boom',
      only_masked_seams: true,
      alpha_method: 'bad',
      alpha_edge_aware: true,
      guided_eps: 99,
      color_match: 'oops',
      poisson_iters: 999,
    })).toEqual({
      texture_kind: 'basecolor',
      band_px: 64,
      feather_px: 0,
      sample_step_px: 0.25,
      mode: 'average',
      only_masked_seams: true,
      alpha_method: 'distance',
      alpha_edge_aware: true,
      guided_eps: 1,
      color_match: 'meanvar',
      poisson_iters: 200,
    });
  });

  it('seam repair API 请求挂起时会按超时中断', async () => {
    globalThis.fetch = createAbortAwarePendingFetch() as typeof fetch;

    await expect(seamRepair(
      new File(['o v 0 0 0'], 'mesh.obj'),
      new File(['png'], 'tex.png'),
      null,
      {
        texture_kind: 'basecolor',
        band_px: 8,
        feather_px: 6,
        sample_step_px: 2,
        mode: 'average',
        only_masked_seams: true,
        alpha_method: 'distance',
        alpha_edge_aware: true,
        guided_eps: 1e-4,
        color_match: 'meanvar',
        poisson_iters: 0,
      },
      { timeoutMs: 20 }
    )).rejects.toThrow('修缝超时');
  });
});
