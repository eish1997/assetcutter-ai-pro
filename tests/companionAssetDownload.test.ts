import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseContentDispositionFilename,
  revealCompanionAssetFolderWithProjectFallback,
} from '../services/companionClient/storage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('companionClient storage download', () => {
  it('parseContentDispositionFilename reads quoted filename', () => {
    expect(parseContentDispositionFilename('attachment; filename="model.glb"')).toBe('model.glb');
  });

  it('parseContentDispositionFilename reads filename*', () => {
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''model%2Efbx")).toBe('model.fbx');
  });

  it('reveals an asset from another local companion project when the active project misses', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.endsWith('/v1/projects/current/assets/model-key/reveal')) {
        return jsonResponse({ error: 'object_missing', code: 'STORAGE_NOT_FOUND' }, 404);
      }
      if (url.endsWith('/v1/projects')) {
        return jsonResponse({ projectIds: ['current', 'archive'] });
      }
      if (url.endsWith('/v1/projects/archive/assets/model-key/meta')) {
        return jsonResponse({
          projectId: 'archive',
          key: 'model-key',
          relPath: 'assets/model-key/object',
          byteSize: 12,
          updatedAt: 1,
          onDisk: true,
        });
      }
      if (url.endsWith('/v1/projects/archive/assets/model-key/reveal')) {
        return jsonResponse({
          ok: true,
          projectId: 'archive',
          key: 'model-key',
          dir: 'D:/AssetCutter/archive/assets/model-key',
          visibleRelPath: 'model.fbx',
          filename: 'model.fbx',
        });
      }
      return jsonResponse({ error: 'missing', code: 'STORAGE_NOT_FOUND' }, 404);
    }));

    const out = await revealCompanionAssetFolderWithProjectFallback(
      'http://127.0.0.1:18765',
      'current',
      'model-key',
    );

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.projectId).toBe('archive');
      expect(out.data.filename).toBe('model.fbx');
    }
    expect(calls).toContain('POST http://127.0.0.1:18765/v1/projects/current/assets/model-key/reveal');
    expect(calls).toContain('GET http://127.0.0.1:18765/v1/projects/archive/assets/model-key/meta');
    expect(calls).toContain('POST http://127.0.0.1:18765/v1/projects/archive/assets/model-key/reveal');
  });
});
