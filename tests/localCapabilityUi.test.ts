import { describe, expect, it } from 'vitest';
import {
  buildLocalCapabilityUi,
  mergeLocalCapabilityUiWithRembgPythonProbe,
  mergeLocalCapabilityUiWithSamHttpProbe,
} from '../local-companion/src/localCapabilityUi.ts';

describe('buildLocalCapabilityUi', () => {
  it('warns when sam spawn configured but not running with exit 1', () => {
    const ui = buildLocalCapabilityUi(
      { configured: false, running: false, lastExitCode: null, lastError: null, lastSignal: null },
      {
        configured: true,
        running: false,
        lastExitCode: 1,
        lastSignal: null,
        lastError: null,
        lastUpdatedAt: 'x',
      },
    );
    expect(ui.tone).toBe('warn');
    expect(ui.headline).toContain('需修复');
    expect(ui.samSpawn.humanBody || '').toContain('退出码 1');
    expect(ui.samSpawn.nextHints.length).toBeGreaterThan(0);
  });

  it('prioritizes relay over sam when relay is broken', () => {
    const ui = buildLocalCapabilityUi(
      { configured: true, running: false, lastExitCode: 1, lastError: 'boom', lastSignal: null },
      { configured: true, running: false, lastExitCode: 1, lastSignal: null, lastError: null, lastUpdatedAt: 'x' },
    );
    expect(ui.headline).toContain('Relay');
    expect(ui.tone).toBe('warn');
  });

  it('ok when nothing broken', () => {
    const ui = buildLocalCapabilityUi(
      { configured: false, running: false, lastExitCode: null, lastError: null, lastSignal: null },
      { configured: true, running: true, lastExitCode: null, lastSignal: null, lastError: null, lastUpdatedAt: 'x' },
    );
    expect(ui.tone).toBe('ok');
    expect(ui.headline).toContain('正常');
  });
});

describe('mergeLocalCapabilityUiWithSamHttpProbe', () => {
  const relayOk = { configured: false, running: false, lastExitCode: null, lastError: null, lastSignal: null };

  it('relaxes sam spawn warn when http probe ok', () => {
    const base = buildLocalCapabilityUi(relayOk, {
      configured: true,
      running: false,
      lastExitCode: 1,
      lastSignal: null,
      lastError: null,
      lastUpdatedAt: 'x',
    });
    const merged = mergeLocalCapabilityUiWithSamHttpProbe(base, { ok: true, samLocal: { latencyMs: 12 } });
    expect(merged.tone).toBe('ok');
    expect(merged.headline).toContain('随启未挂接');
    expect(merged.subline).toContain('12 ms');
  });

  it('does not override relay warn', () => {
    const base = buildLocalCapabilityUi(
      { configured: true, running: false, lastExitCode: 1, lastError: 'boom', lastSignal: null },
      { configured: true, running: false, lastExitCode: 1, lastSignal: null, lastError: null, lastUpdatedAt: 'x' },
    );
    const merged = mergeLocalCapabilityUiWithSamHttpProbe(base, { ok: true, samLocal: { latencyMs: 5 } });
    expect(merged.headline).toContain('Relay');
    expect(merged.tone).toBe('warn');
  });

  it('keeps warn when probe not ok', () => {
    const base = buildLocalCapabilityUi(relayOk, {
      configured: true,
      running: false,
      lastExitCode: 1,
      lastSignal: null,
      lastError: null,
      lastUpdatedAt: 'x',
    });
    const merged = mergeLocalCapabilityUiWithSamHttpProbe(base, { ok: false });
    expect(merged.tone).toBe('warn');
    expect(merged.headline).toContain('需修复');
  });
});

describe('mergeLocalCapabilityUiWithRembgPythonProbe', () => {
  const relayOk = { configured: false, running: false, lastExitCode: null, lastError: null, lastSignal: null };

  it('escalates ok ui to warn when rembg fails', () => {
    const base = buildLocalCapabilityUi(relayOk, {
      configured: true,
      running: true,
      lastExitCode: null,
      lastSignal: null,
      lastError: null,
      lastUpdatedAt: 'x',
    });
    const merged = mergeLocalCapabilityUiWithRembgPythonProbe(base, {
      ok: false,
      code: 'COMPUTE_REMBG_NOT_INSTALLED',
      error: 'No module named rembg',
    });
    expect(merged.tone).toBe('warn');
    expect(merged.headline).toContain('去背景');
    expect(merged.subline).toContain('正常');
  });

  it('appends to subline when relay warn', () => {
    const base = buildLocalCapabilityUi(
      { configured: true, running: false, lastExitCode: 1, lastError: 'x', lastSignal: null },
      { configured: true, running: true, lastExitCode: null, lastSignal: null, lastError: null, lastUpdatedAt: 'x' },
    );
    const merged = mergeLocalCapabilityUiWithRembgPythonProbe(base, { ok: false, error: 'bad rembg' });
    expect(merged.headline).toContain('Relay');
    expect(merged.subline).toContain('去背景');
  });
});
