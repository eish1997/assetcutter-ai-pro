import { describe, expect, it } from 'vitest';
import {
  ensureDownloadFilenameExtension,
  ensureDownloadFilenameExtensionSync,
  sniffImageMimeFromHead,
} from '../services/downloadFilename';

describe('ensureDownloadFilenameExtension', () => {
  it('keeps existing extension', async () => {
    const name = await ensureDownloadFilenameExtension('photo.png', {
      mime: 'image/jpeg',
    });
    expect(name).toBe('photo.png');
  });

  it('appends extension from mime when missing', async () => {
    const name = await ensureDownloadFilenameExtension('workflow-abc', {
      mime: 'image/png',
    });
    expect(name).toBe('workflow-abc.png');
  });

  it('sniffs png from blob head when mime is octet-stream', async () => {
    const pngHead = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const name = await ensureDownloadFilenameExtension('asset', {
      mime: 'application/octet-stream',
      headBytes: pngHead,
    });
    expect(name).toBe('asset.png');
    expect(sniffImageMimeFromHead(pngHead)).toBe('image/png');
  });

  it('sync helper matches async for hinted names', () => {
    expect(ensureDownloadFilenameExtensionSync('title', { mime: 'image/jpeg' })).toBe('title.jpg');
  });
});
