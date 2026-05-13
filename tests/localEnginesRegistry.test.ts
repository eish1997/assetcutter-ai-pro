import { describe, expect, it } from 'vitest';
import { buildRuntimeLocalEnginesStatus, LOCAL_ENGINES_REGISTRY } from '../local-companion/src/localEnginesRegistry.ts';

describe('LOCAL_ENGINES_REGISTRY', () => {
  it('includes sam and rembg entries', () => {
    const ids = LOCAL_ENGINES_REGISTRY.map((e) => e.id);
    expect(ids).toContain('sam_segment');
    expect(ids).toContain('remove_bg');
  });
});

describe('buildRuntimeLocalEnginesStatus', () => {
  const okRembg = { ok: true, latencyMs: 7 };
  const okSam = { ok: true, samLocal: { latencyMs: 33 } };

  it('marks sam health checked and maps probe fields', () => {
    const rows = buildRuntimeLocalEnginesStatus({ sam: okSam, rembg: okRembg });
    const sam = rows.find((r) => r.id === 'sam_segment');
    expect(sam?.health.checked).toBe(true);
    expect(sam?.health.ok).toBe(true);
    expect(sam?.health.latencyMs).toBe(33);
  });

  it('passes probe failure to sam row', () => {
    const rows = buildRuntimeLocalEnginesStatus({
      sam: { ok: false, code: 'SAM_PROBE_NOT_LOOPBACK', error: 'bad' },
      rembg: okRembg,
    });
    const sam = rows.find((r) => r.id === 'sam_segment');
    expect(sam?.health.ok).toBe(false);
    expect(sam?.health.code).toBe('SAM_PROBE_NOT_LOOPBACK');
    expect(sam?.health.error).toBe('bad');
  });

  it('maps rembg python probe to remove_bg row', () => {
    const rows = buildRuntimeLocalEnginesStatus({
      sam: okSam,
      rembg: { ok: false, latencyMs: 12, code: 'COMPUTE_REMBG_NOT_INSTALLED', error: 'no module' },
    });
    const rem = rows.find((r) => r.id === 'remove_bg');
    expect(rem?.health.checked).toBe(true);
    expect(rem?.health.ok).toBe(false);
    expect(rem?.health.code).toBe('COMPUTE_REMBG_NOT_INSTALLED');
    expect(rem?.healthStrategy).toBe('companion_python_probe_rembg');
  });
});
