import { describe, expect, it, vi } from 'vitest';

import { probeStoryboardCompanionOcrReady } from '../services/storyboardCompanionOcrImport';

vi.mock('../services/companionClient', () => ({
  probeCompanionPaddleOcrHealth: vi.fn(),
}));

import { probeCompanionPaddleOcrHealth } from '../services/companionClient';

describe('probeStoryboardCompanionOcrReady', () => {
  it('requires project id', async () => {
    await expect(probeStoryboardCompanionOcrReady('http://127.0.0.1:18765', '')).resolves.toEqual({
      ok: false,
      error: '未选择工作区项目（伴侣 Volume 需要 projectId）',
    });
  });

  it('passes when paddle health ok', async () => {
    vi.mocked(probeCompanionPaddleOcrHealth).mockResolvedValue({
      ok: true,
      body: { ok: true, serviceUrl: 'http://127.0.0.1:18082' },
    });
    await expect(probeStoryboardCompanionOcrReady('http://127.0.0.1:18765', 'proj-1')).resolves.toEqual({
      ok: true,
    });
  });

  it('fails when health not ok', async () => {
    vi.mocked(probeCompanionPaddleOcrHealth).mockResolvedValue({
      ok: true,
      body: { ok: false, error: 'connection refused' },
    });
    await expect(probeStoryboardCompanionOcrReady('http://127.0.0.1:18765', 'proj-1')).resolves.toMatchObject({
      ok: false,
    });
  });
});
