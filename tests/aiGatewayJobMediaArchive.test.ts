import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/r2-storage-handlers.js', () => ({
  isR2Configured: vi.fn(() => true),
  putPublicR2Object: vi.fn(async (objectKey: string, body: Buffer, options: { contentType?: string } = {}) => ({
    objectKey,
    publicUrl: `https://cdn.example.com/${objectKey}`,
    bytes: body.length,
    contentType: options.contentType,
  })),
}));

import { archiveAiGatewayJobMedia } from '../server/ai-gateway/job-media-archive.js';
import { putPublicR2Object } from '../server/r2-storage-handlers.js';

describe('archiveAiGatewayJobMedia', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('archives remote video URLs to R2 so browser previews use stable media', async () => {
    const mp4Header = Buffer.from('000000206674797069736f6d00000200', 'hex');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(mp4Header, {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-range': `bytes 0-${mp4Header.length - 1}/${mp4Header.length}`,
          },
        })
      )
    );

    const archived = await archiveAiGatewayJobMedia({
      job: {
        id: 'aijob_video_archive',
        userId: 'user_1',
        output: {
          videoUrl: 'https://upstream.example.com/signed-video',
        },
        artifacts: [
          {
            kind: 'video',
            url: 'https://upstream.example.com/signed-video',
          },
        ],
      },
    });

    expect(putPublicR2Object).toHaveBeenCalled();
    expect(archived.job.output.videoUrl).toMatch(/^https:\/\/cdn\.example\.com\/public\/ai-gateway-results\//);
    expect(archived.job.output.upstreamUrl).toBe('https://upstream.example.com/signed-video');
    expect(archived.job.artifacts[0].url).toMatch(/^https:\/\/cdn\.example\.com\/public\/ai-gateway-results\//);
    expect(archived.job.artifacts[0].mimeType).toBe('video/mp4');
    expect(archived.job.artifacts[0].archived).toBe(true);
  });
});
