import { describe, expect, it, vi } from 'vitest';
import { createRenderHost } from '../services/renderCore/renderHost';
import type { RendererAdapter } from '../services/renderCore/types';

function mockAdapter(backend: 'webgpu' | 'webgl', initImpl?: () => Promise<void>): RendererAdapter {
  const canvas = {
    toDataURL: () => `data:image/png;base64,${backend}`,
  } as HTMLCanvasElement;
  return {
    backend,
    renderer: { backend },
    domElement: canvas,
    init: initImpl ?? (async () => undefined),
    applyVisualOptions: () => undefined,
    resize: () => undefined,
    render: () => undefined,
    capture: (mimeType = 'image/png') => `data:${mimeType};base64,${backend}`,
    dispose: () => undefined,
  };
}

describe('createRenderHost', () => {
  it('uses WebGPU when preferred and supported', async () => {
    const host = createRenderHost({
      preferredBackend: 'webgpu',
      detectWebGpuSupport: async () => ({ supported: true }),
      createWebGpuAdapter: () => mockAdapter('webgpu'),
      createWebGlAdapter: () => mockAdapter('webgl'),
    });

    await host.init();

    expect(host.backend).toBe('webgpu');
    expect(host.fallbackUsed).toBe(false);
    expect(host.getDebugState().activeBackend).toBe('webgpu');
  });

  it('falls back to WebGL when WebGPU unsupported', async () => {
    const host = createRenderHost({
      preferredBackend: 'webgpu',
      detectWebGpuSupport: async () => ({
        supported: false,
        reason: 'no-navigator.gpu',
      }),
      createWebGpuAdapter: () => mockAdapter('webgpu'),
      createWebGlAdapter: () => mockAdapter('webgl'),
    });

    await host.init();

    expect(host.backend).toBe('webgl');
    expect(host.fallbackUsed).toBe(true);
    expect(host.fallbackReason).toContain('webgpu-unsupported');
  });

  it('falls back to WebGL when WebGPU init throws', async () => {
    const host = createRenderHost({
      preferredBackend: 'auto',
      detectWebGpuSupport: async () => ({ supported: true }),
      createWebGpuAdapter: () =>
        mockAdapter('webgpu', async () => {
          throw new Error('device lost');
        }),
      createWebGlAdapter: () => mockAdapter('webgl'),
    });

    await host.init();

    expect(host.backend).toBe('webgl');
    expect(host.fallbackUsed).toBe(true);
    expect(host.fallbackReason).toContain('webgpu-init-failed');
  });

  it('honors preferredBackend=webgl without probing WebGPU', async () => {
    const detect = vi.fn(async () => ({ supported: true }));
    const host = createRenderHost({
      preferredBackend: 'webgl',
      detectWebGpuSupport: detect,
      createWebGpuAdapter: () => mockAdapter('webgpu'),
      createWebGlAdapter: () => mockAdapter('webgl'),
    });

    await host.init();

    expect(detect).not.toHaveBeenCalled();
    expect(host.backend).toBe('webgl');
    expect(host.fallbackUsed).toBe(false);
  });

  it('requireClassicWebGl skips WebGPU entirely (no init-then-tear-down)', async () => {
    const detect = vi.fn(async () => ({ supported: true }));
    const createWebGpu = vi.fn(() => mockAdapter('webgpu'));
    const host = createRenderHost({
      preferredBackend: 'webgpu',
      requireClassicWebGl: true,
      detectWebGpuSupport: detect,
      createWebGpuAdapter: createWebGpu,
      createWebGlAdapter: () => mockAdapter('webgl'),
    });

    await host.init();

    expect(detect).not.toHaveBeenCalled();
    expect(createWebGpu).not.toHaveBeenCalled();
    expect(host.backend).toBe('webgl');
    expect(host.fallbackUsed).toBe(true);
    expect(host.fallbackReason).toBe('classic-webgl-required');
  });
});

describe('detectWebGpuSupport companion shell', () => {
  it('disables WebGPU when companionShell is present', async () => {
    const { detectWebGpuSupport } = await import('../services/renderCore/capabilityDetector');
    const prev = (globalThis as { companionShell?: unknown }).companionShell;
    (globalThis as { companionShell?: unknown }).companionShell = { ok: true };
    (globalThis as { window?: unknown }).window = globalThis;
    try {
      await expect(detectWebGpuSupport()).resolves.toEqual({
        supported: false,
        reason: 'companion-shell-webgpu-disabled',
      });
    } finally {
      if (prev === undefined) delete (globalThis as { companionShell?: unknown }).companionShell;
      else (globalThis as { companionShell?: unknown }).companionShell = prev;
    }
  });
});
