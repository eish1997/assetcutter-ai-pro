import { describe, expect, it } from 'vitest';
import { classifyR2MediaPrereq, pickArchivedImageUrl } from '../scripts/check-ai-gateway-r2-media.mjs';

describe('AI Gateway R2 media smoke helpers (C14)', () => {
  it('skips when R2 missing or no archived sample', () => {
    expect(classifyR2MediaPrereq({ r2Configured: false, hasArchivedUrl: false })).toEqual({
      status: 'skipped',
      reason: 'r2_not_configured',
    });
    expect(classifyR2MediaPrereq({ r2Configured: true, hasArchivedUrl: false })).toEqual({
      status: 'skipped',
      reason: 'no_archived_media_sample',
    });
    expect(classifyR2MediaPrereq({ r2Configured: true, hasArchivedUrl: true }).status).toBe('ready');
  });

  it('picks archived artifact urls', () => {
    expect(
      pickArchivedImageUrl([
        {
          artifacts: [{ kind: 'image', url: 'https://cdn.example.com/public/ai-gateway-results/u/j/a.png', archived: true }],
        },
      ])
    ).toContain('/public/ai-gateway-results/');
  });
});
