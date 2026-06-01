import { describe, expect, it, vi } from 'vitest';
import * as probe from '../services/companionClient/probe';
import {
  probeStoryboardSheetGenCompanionReady,
  storyboardSheetGenCompanionProbeMessage,
} from '../services/storyboardTableSheetGen';

describe('probeStoryboardSheetGenCompanionReady', () => {
  it('fails when base url or project id is missing', async () => {
    await expect(probeStoryboardSheetGenCompanionReady('', 'proj-1')).resolves.toEqual({
      ok: false,
      reason: 'missing_config',
    });
    await expect(probeStoryboardSheetGenCompanionReady('http://127.0.0.1:18765', '')).resolves.toEqual({
      ok: false,
      reason: 'missing_config',
    });
  });

  it('fails when companion health probe fails', async () => {
    vi.spyOn(probe, 'probeCompanionHealth').mockResolvedValue({ ok: false, error: 'offline' });
    await expect(
      probeStoryboardSheetGenCompanionReady('http://127.0.0.1:18765', 'proj-1')
    ).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
    });
    vi.restoreAllMocks();
  });

  it('passes when companion health probe succeeds', async () => {
    vi.spyOn(probe, 'probeCompanionHealth').mockResolvedValue({ ok: true, latencyMs: 12 });
    await expect(
      probeStoryboardSheetGenCompanionReady('http://127.0.0.1:18765', 'proj-1')
    ).resolves.toEqual({ ok: true });
    vi.restoreAllMocks();
  });

  it('returns user-facing messages by reason', () => {
    expect(storyboardSheetGenCompanionProbeMessage('missing_config')).toContain('本地伴侣');
    expect(storyboardSheetGenCompanionProbeMessage('unreachable')).toContain('不可达');
  });
});
