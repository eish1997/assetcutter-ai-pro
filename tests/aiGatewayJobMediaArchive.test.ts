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
    vi.clearAllMocks();
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

  it('archives bare base64 image payloads returned by Jimeng before persistence redaction', async () => {
    const bareBase64Image = Buffer.alloc(9000, 7).toString('base64');

    const archived = await archiveAiGatewayJobMedia({
      job: {
        id: 'aijob_jimeng_bare_base64',
        userId: 'user_1',
        output: {
          provider: 'volcengine-jimeng',
          images: [bareBase64Image],
        },
        artifacts: [
          {
            kind: 'image',
            url: bareBase64Image,
            source: 'volcengine-jimeng',
          },
        ],
      },
    });

    expect(putPublicR2Object).toHaveBeenCalledTimes(1);
    expect(putPublicR2Object).toHaveBeenCalledWith(
      expect.stringMatching(/public\/ai-gateway-results\/user_1\/aijob_jimeng_bare_base64\/.+\.png$/),
      expect.any(Buffer),
      { contentType: 'image/png' }
    );
    expect(archived.job.output.images[0]).toMatch(/^https:\/\/cdn\.example\.com\/public\/ai-gateway-results\//);
    expect(archived.job.artifacts[0]).toMatchObject({
      kind: 'image',
      url: expect.stringMatching(/^https:\/\/cdn\.example\.com\/public\/ai-gateway-results\//),
      mimeType: 'image/png',
      archived: true,
      inlineData: false,
    });
    expect(archived.job.artifacts[0].url).toBe(archived.job.output.images[0]);
  });
});
