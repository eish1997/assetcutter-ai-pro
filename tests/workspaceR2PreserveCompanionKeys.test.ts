import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/httpClient', () => ({
  requestJson: vi.fn(async (url: string) => {
    if (String(url).includes('/upload-url') || String(url).includes('uploadUrl')) {
      return {
        uploadUrl: 'https://upload.example.com/put',
        objectKey: 'users/u/workspace/objects/sha256/abc.jpg',
      };
    }
    if (String(url).includes('head') || String(url).includes('exists')) {
      return { exists: false };
    }
    return { downloadUrl: 'https://cdn.example.com/x.jpg', objectKey: 'k' };
  }),
}));

vi.mock('../services/apiBase', () => ({
  r2ApiUrl: (path: string) => `http://auth.test${path}`,
}));

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('upload.example.com') || init?.method === 'PUT') {
    return new Response(null, { status: 200 });
  }
  if (url.includes('/exists') || url.includes('Head')) {
    return new Response(JSON.stringify({ exists: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ exists: false }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
});

vi.stubGlobal('fetch', fetchMock);

import { packWorkflowBundleForCloud } from '../services/workspaceR2ImageBundle';
import type { WorkflowAsset } from '../types';

describe('packWorkflowBundleForCloud preserves companion locators', () => {
  beforeEach(() => {
    fetchMock.mockClear();
  });

  it('keeps originalCompanionKey and resultsCompanionKeys after packing', async () => {
    const asset = {
      id: 'asset-1',
      original: 'data:image/jpeg;base64,/9j/4AAQ',
      originalCompanionKey: 'asset-1/original-image-asset-1.jpg',
      displayKey: 'step-a',
      results: { 'step-a': 'data:image/jpeg;base64,/9j/4AAQ' },
      resultsCompanionKeys: { 'step-a': 'asset-1/result-step-a.jpg' },
      resultOrder: ['step-a'],
      archived: false,
      hiddenInGrid: false,
      createdAt: 1,
    } satisfies WorkflowAsset;

    const packed = await packWorkflowBundleForCloud('user-1', 'proj-1', {
      assets: [asset],
      pending: [],
    });

    expect(packed.assets[0]?.originalCompanionKey).toBe('asset-1/original-image-asset-1.jpg');
    expect(packed.assets[0]?.resultsCompanionKeys?.['step-a']).toBe('asset-1/result-step-a.jpg');
  });
});
