import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseGatewayStatusOutput, collectProbeApiKeys } = require('../companion-desktop/hermes-official-host.cjs');
const { probeGatewayWithKeys } = require('../companion-desktop/hermes-gateway-host.cjs');

describe('hermesOfficialHost', () => {
  it('parseGatewayStatusOutput detects running PID', () => {
    const out = parseGatewayStatusOutput(
      '✓ Scheduled Task registered: Hermes_Gateway\n✓ Gateway process running (PID: 28172)\n',
      '',
    );
    expect(out.running).toBe(true);
    expect(out.pid).toBe(28172);
  });

  it('parseGatewayStatusOutput detects stopped gateway', () => {
    const out = parseGatewayStatusOutput('Gateway is not running\n', '');
    expect(out.running).toBe(false);
    expect(out.pid).toBeNull();
  });

  it('collectProbeApiKeys puts cfg key first', () => {
    const keys = collectProbeApiKeys({ apiKey: 'abc' }, null);
    expect(keys[0]).toBe('abc');
  });
});

describe('probeGatewayWithKeys', () => {
  it('returns first matching key', async () => {
    const orig = global.fetch;
    let call = 0;
    global.fetch = (async () => {
      call += 1;
      if (call === 1) return { ok: false, status: 401 };
      return { ok: true, status: 200 };
    }) as typeof fetch;
    try {
      const r = await probeGatewayWithKeys('http://127.0.0.1:8642/v1', ['bad', 'good']);
      expect(r.ok).toBe(true);
      expect(r.apiKey).toBe('good');
    } finally {
      global.fetch = orig;
    }
  });
});
