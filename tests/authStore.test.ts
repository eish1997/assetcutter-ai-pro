import fs from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPasswordHash, readDb, verifyPassword, writeDb } from '../server/auth-store.js';
import { resolveAuthDbFileForTests } from './helpers/authDbTestPath.js';

describe('auth-store password hash', () => {
  it('可以正确校验密码', () => {
    const password = 'abc12345';
    const hash = createPasswordHash(password);
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword(password, hash)).toBe(true);
    expect(verifyPassword('wrong-pass', hash)).toBe(false);
  });
});

describe('auth-store JSON fs resilience', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries UNKNOWN open on readDb then succeeds', () => {
    const dbPath = resolveAuthDbFileForTests();
    writeDb({ version: 1, users: [], sessions: [], auditLogs: [], probe: 'retry-read' });
    const realRead = fs.readFileSync.bind(fs);
    let opens = 0;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((path, options) => {
      if (String(path) === dbPath) {
        opens += 1;
        if (opens === 1) {
          const err = new Error(`UNKNOWN: unknown error, open '${dbPath}'`) as NodeJS.ErrnoException;
          err.code = 'UNKNOWN';
          err.syscall = 'open';
          throw err;
        }
      }
      return realRead(path, options as BufferEncoding);
    }) as typeof fs.readFileSync);

    const db = readDb();
    expect(opens).toBeGreaterThanOrEqual(2);
    expect(db).toMatchObject({ probe: 'retry-read' });
  });

  it('writeDb round-trips after atomic replace', () => {
    writeDb({ version: 1, users: [], sessions: [], auditLogs: [], probe: 'atomic-write' });
    expect(readDb()).toMatchObject({ probe: 'atomic-write' });
    const raw = fs.readFileSync(resolveAuthDbFileForTests(), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

