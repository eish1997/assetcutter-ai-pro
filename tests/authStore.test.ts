import { describe, expect, it } from 'vitest';
import { createPasswordHash, verifyPassword } from '../server/auth-store.js';

describe('auth-store password hash', () => {
  it('可以正确校验密码', () => {
    const password = 'abc12345';
    const hash = createPasswordHash(password);
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword(password, hash)).toBe(true);
    expect(verifyPassword('wrong-pass', hash)).toBe(false);
  });
});

