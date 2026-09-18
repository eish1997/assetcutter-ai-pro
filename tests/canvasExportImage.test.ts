// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  candidateFetchUrlsForCanvasExport,
  loadImageForCanvasExport,
  needsAnonymousCrossOrigin,
} from '../services/canvasExportImage';

describe('needsAnonymousCrossOrigin', () => {
  it('skips data and relative paths', () => {
    expect(needsAnonymousCrossOrigin('data:image/png;base64,aaa', 'https://app.example')).toBe(false);
    expect(needsAnonymousCrossOrigin('/api/r2/capability-store/a.jpg', 'https://app.example')).toBe(false);
  });

  it('flags mapped auth-api hosts used by production static sites', () => {
    expect(
      needsAnonymousCrossOrigin(
        'https://auth.example/api/r2/capability-store/pano.jpg',
        'https://app.example'
      )
    ).toBe(true);
    expect(
      needsAnonymousCrossOrigin('https://app.example/api/r2/capability-store/pano.jpg', 'https://app.example')
    ).toBe(false);
  });
});

describe('candidateFetchUrlsForCanvasExport', () => {
  it('adds same-origin /api/r2 fallback after an absolute API URL', () => {
    const urls = candidateFetchUrlsForCanvasExport(
      'https://auth.example/api/r2/capability-store/pano.jpg?v=1',
      'https://app.example'
    );
    expect(urls[0]).toBe('https://auth.example/api/r2/capability-store/pano.jpg?v=1');
    expect(urls).toContain('https://app.example/api/r2/capability-store/pano.jpg?v=1');
  });

  it('does not invent fallbacks for non-R2 remotes', () => {
    expect(candidateFetchUrlsForCanvasExport('https://cdn.example/a.jpg', 'https://app.example')).toEqual([
      'https://cdn.example/a.jpg',
    ]);
  });
});

describe('loadImageForCanvasExport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches a blob first so the canvas Image is same-origin', async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const fetchMock = vi.fn(
      async () => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    class FakeImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);

    const loaded = await loadImageForCanvasExport('https://auth.example/api/r2/capability-store/pano.jpg');
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toContain('/api/r2/capability-store/pano.jpg');
    expect((loaded.image as unknown as FakeImage).crossOrigin).toBe('');
    loaded.revoke();
  });

  it('falls back to anonymous CORS Image when fetch is blocked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    class FakeImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);

    const loaded = await loadImageForCanvasExport('https://auth.example/api/r2/capability-store/pano.jpg');
    expect((loaded.image as unknown as FakeImage).crossOrigin).toBe('anonymous');
    loaded.revoke();
  });
});
