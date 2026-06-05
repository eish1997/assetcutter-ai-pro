import { describe, expect, it } from 'vitest';

describe('ensureAdminRbac', () => {
  it('JSON 模式下 init 不会死锁', async () => {
    const prevDbUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = '';
    try {
      const { ensureAdminRbac } = await import('../server/admin-roles-store.js');
      const started = Date.now();
      await Promise.race([
        ensureAdminRbac(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ensureAdminRbac timeout')), 5000)),
      ]);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDbUrl;
    }
  });
});
