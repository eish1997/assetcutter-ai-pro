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

  it('does not archive remote video URLs into cloud object storage', async () => {
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

    expect(putPublicR2Object).not.toHaveBeenCalled();
    expect(archived.job.output.videoUrl).toBe('https://upstream.example.com/signed-video');
    expect(archived.job.artifacts[0].url).toBe('https://upstream.example.com/signed-video');
  });

  it('still archives inline data URLs to avoid persisting large base64 job payloads', async () => {
    const archived = await archiveAiGatewayJobMedia({
      job: {
        id: 'aijob_image_archive',
        userId: 'user_1',
        output: {
          imageUrl: 'data:image/png;base64,QUJD',
        },
      },
    });

    expect(putPublicR2Object).toHaveBeenCalled();
    expect(archived.job.output.imageUrl).toMatch(/^https:\/\/cdn\.example\.com\/public\/ai-gateway-results\//);
    expect(archived.job.output.archived).toBe(true);
  });
});
