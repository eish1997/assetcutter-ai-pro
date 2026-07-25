import { describe, expect, it } from 'vitest';
import {
  aggregateLaneResults,
  classifyProviderKeyPrereq,
  exitCodeForStatus,
  extractProxyJobId,
} from '../scripts/ai-gateway-smoke-lib.mjs';

describe('AI Gateway smoke matrix helpers (C10 / D1)', () => {
  it('exitCodeForStatus: blocked is 2 when reportBlocked even if optional', () => {
    expect(exitCodeForStatus('blocked', { optional: true, reportBlocked: true })).toBe(2);
    expect(exitCodeForStatus('blocked', { optional: true, reportBlocked: false })).toBe(0);
    expect(exitCodeForStatus('failed')).toBe(1);
  });

  it('classifyProviderKeyPrereq blocks missing admin or key', () => {
    expect(
      classifyProviderKeyPrereq({
        identifier: '',
        password: 'x',
        hasProviderKey: true,
        providerId: 'tripo',
      }).status
    ).toBe('blocked');
    expect(
      classifyProviderKeyPrereq({
        identifier: 'admin',
        password: 'x',
        hasProviderKey: false,
        providerId: 'tripo',
      })
    ).toEqual({ status: 'blocked', reason: 'missing_tripo_key' });
  });

  it('extractProxyJobId reads nested generation payloads', () => {
    expect(extractProxyJobId({ result: { proxyJobId: 'gasync_1' } })).toBe('gasync_1');
    expect(extractProxyJobId({ job: { metadata: { proxyJobId: 'gasync_2' } } })).toBe('gasync_2');
    expect(extractProxyJobId({ ok: true })).toBe('');
  });

  it('aggregateLaneResults: all-skip is skipped, not ok', () => {
    expect(
      aggregateLaneResults(
        [
          { id: '302', exitCode: 2 },
          { id: 'vertex', exitCode: 2 },
          { id: 'jimeng', exitCode: 2 },
          { id: 'tripo', exitCode: 2 },
        ],
        { optional: true }
      )
    ).toMatchObject({ status: 'skipped', exitCode: 0, hasGeneration: false });
  });

  it('aggregateLaneResults: hard-fail wins', () => {
    expect(
      aggregateLaneResults(
        [
          { id: '302', exitCode: 0 },
          { id: 'vertex', exitCode: 1 },
        ],
        { optional: true }
      )
    ).toMatchObject({ status: 'failed', exitCode: 1 });
  });

  it('aggregateLaneResults: live 302 ok + others skip → ok (has Generation)', () => {
    expect(
      aggregateLaneResults(
        [
          { id: '302', exitCode: 0 },
          { id: 'vertex', exitCode: 2 },
        ],
        { optional: true, dryRun: false }
      )
    ).toMatchObject({ status: 'ok', exitCode: 0, hasGeneration: true });
  });

  it('aggregateLaneResults: dry-run never ok unless allowRouteOnly', () => {
    expect(
      aggregateLaneResults(
        [
          { id: '302', exitCode: 0 },
          { id: 'vertex', exitCode: 2 },
        ],
        { optional: true, dryRun: true }
      )
    ).toMatchObject({ status: 'dry_run', exitCode: 0, hasGeneration: false });

    expect(
      aggregateLaneResults([{ id: '302', exitCode: 0 }], {
        optional: false,
        dryRun: true,
      })
    ).toMatchObject({ status: 'dry_run', exitCode: 2 });

    expect(
      aggregateLaneResults([{ id: '302', exitCode: 0 }], {
        optional: true,
        dryRun: true,
        allowRouteOnly: true,
      })
    ).toMatchObject({ status: 'ok', exitCode: 0 });
  });

  it('aggregateLaneResults: build-sha alone is incomplete, not ok', () => {
    expect(
      aggregateLaneResults(
        [
          { id: 'build-sha', exitCode: 0 },
          { id: 'r2-media', exitCode: 2 },
          { id: '302', exitCode: 2 },
          { id: 'vertex', exitCode: 2 },
        ],
        { optional: true, dryRun: false }
      )
    ).toMatchObject({ status: 'incomplete', exitCode: 0, hasGeneration: false });

    // optional=false: exit 2 is blocked (missing creds), not incomplete
    expect(
      aggregateLaneResults(
        [
          { id: 'build-sha', exitCode: 0 },
          { id: '302', exitCode: 2 },
        ],
        { optional: false, dryRun: false }
      )
    ).toMatchObject({ status: 'blocked', exitCode: 2 });

    // optional=false incomplete: non-generation ok only (no exit-2 lanes)
    expect(
      aggregateLaneResults([{ id: 'build-sha', exitCode: 0 }, { id: 'r2-media', exitCode: 0 }], {
        optional: false,
        dryRun: false,
      })
    ).toMatchObject({ status: 'incomplete', exitCode: 2, hasGeneration: false });
  });
});

