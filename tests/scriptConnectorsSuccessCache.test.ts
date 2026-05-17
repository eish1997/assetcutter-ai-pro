import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { parseScriptConnectorsCacheTtlMs } from '../local-companion/src/scriptRun/scriptConnectorsCacheTtl.ts';
import {
  invalidateScriptConnectorsCache,
  readScriptConnectorsSuccessCache,
  writeScriptConnectorsSuccessCache,
} from '../local-companion/src/scriptRun/scriptConnectorsSuccessCache.ts';

describe('scriptConnectorsSuccessCache', () => {
  beforeEach(() => {
    invalidateScriptConnectorsCache();
  });

  it('returns null when bust', () => {
    writeScriptConnectorsSuccessCache('127.0.0.1:7001', 0, { ok: true });
    expect(readScriptConnectorsSuccessCache('127.0.0.1:7001', 10_000, 1, true)).toBeNull();
  });

  it('returns null when ttl is 0', () => {
    writeScriptConnectorsSuccessCache('127.0.0.1:7001', 0, { ok: true });
    expect(readScriptConnectorsSuccessCache('127.0.0.1:7001', 0, 5, false)).toBeNull();
  });

  it('returns hit when key matches and within ttl', () => {
    const body = { protocolVersion: 1 as const, probedAt: 'x', connectors: [] };
    writeScriptConnectorsSuccessCache('h:1', 1000, body);
    expect(readScriptConnectorsSuccessCache('h:1', 5000, 2000, false)).toBe(body);
  });

  it('returns null when key differs', () => {
    writeScriptConnectorsSuccessCache('a:1', 0, {});
    expect(readScriptConnectorsSuccessCache('b:1', 10_000, 1, false)).toBeNull();
  });

  it('returns null when expired', () => {
    writeScriptConnectorsSuccessCache('k', 0, { v: 1 });
    expect(readScriptConnectorsSuccessCache('k', 100, 500, false)).toBeNull();
  });
});

describe('parseScriptConnectorsCacheTtlMs', () => {
  const prev = process.env.COMPANION_SCRIPT_CONNECTORS_CACHE_MS;

  afterEach(() => {
    if (prev === undefined) delete process.env.COMPANION_SCRIPT_CONNECTORS_CACHE_MS;
    else process.env.COMPANION_SCRIPT_CONNECTORS_CACHE_MS = prev;
  });

  it('defaults to 4000', () => {
    delete process.env.COMPANION_SCRIPT_CONNECTORS_CACHE_MS;
    expect(parseScriptConnectorsCacheTtlMs()).toBe(4000);
  });

  it('0 means off', () => {
    process.env.COMPANION_SCRIPT_CONNECTORS_CACHE_MS = '0';
    expect(parseScriptConnectorsCacheTtlMs()).toBe(0);
  });

  it('caps at 120000', () => {
    process.env.COMPANION_SCRIPT_CONNECTORS_CACHE_MS = '999999';
    expect(parseScriptConnectorsCacheTtlMs()).toBe(120_000);
  });
});
