import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/workflowCompanionAssets', () => ({
  parseDataUrlToBlob: vi.fn((src: string) => {
    if (!String(src || '').startsWith('data:')) return null;
    return { blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), mime: 'image/png' };
  }),
  imageSrcToDataUrlForCompanion: vi.fn(async () => null),
}));

vi.mock('../services/mediaUrlAuthFetch', () => ({
  fetchMediaUrlViaAuthApi: vi.fn(async () => new Blob([new Uint8Array([9, 8, 7])], { type: 'image/png' })),
}));

vi.mock('../services/workbenchDownloadBridge', () => ({
  downloadBlobPreferWorkbench: vi.fn(async () => true),
  showDownloadNotice: vi.fn(),
}));

vi.mock('../services/downloadFilename', () => ({
  ensureDownloadFilenameExtension: vi.fn(async (name: string) => name),
}));

import { downloadPbrTextureDataUrl } from '../services/workflowModelPbrTextureActions';
import { fetchMediaUrlViaAuthApi } from '../services/mediaUrlAuthFetch';
import { downloadBlobPreferWorkbench, showDownloadNotice } from '../services/workbenchDownloadBridge';

describe('downloadPbrTextureDataUrl', () => {
  beforeEach(() => {
    vi.mocked(fetchMediaUrlViaAuthApi).mockClear();
    vi.mocked(downloadBlobPreferWorkbench).mockClear();
    vi.mocked(showDownloadNotice).mockClear();
  });

  it('downloads data URL via blob save (not bare anchor navigate)', async () => {
    const ok = await downloadPbrTextureDataUrl('data:image/png;base64,AAA=', 'slot.png');
    expect(ok).toBe(true);
    expect(fetchMediaUrlViaAuthApi).not.toHaveBeenCalled();
    expect(downloadBlobPreferWorkbench).toHaveBeenCalledWith(
      expect.any(Blob),
      'slot.png',
      expect.objectContaining({ noticeTitle: '图片已保存' })
    );
  });

  it('fetches cross-origin https via auth-api then saves blob', async () => {
    const ok = await downloadPbrTextureDataUrl('https://file.302.ai/demo.png', 'gen.png');
    expect(ok).toBe(true);
    expect(fetchMediaUrlViaAuthApi).toHaveBeenCalledWith('https://file.302.ai/demo.png');
    expect(downloadBlobPreferWorkbench).toHaveBeenCalled();
  });

  it('notices when remote bytes cannot be fetched', async () => {
    vi.mocked(fetchMediaUrlViaAuthApi).mockRejectedValueOnce(new Error('proxy down'));
    const ok = await downloadPbrTextureDataUrl('https://file.302.ai/missing.png', 'x.png');
    expect(ok).toBe(false);
    expect(showDownloadNotice).toHaveBeenCalledWith('warn', '下载失败', '无法获取贴图原图');
    expect(downloadBlobPreferWorkbench).not.toHaveBeenCalled();
  });
});
