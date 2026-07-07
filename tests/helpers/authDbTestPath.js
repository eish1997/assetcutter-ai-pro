import path from 'path';

/** 与 server/auth-store.js 一致：Vitest 下读写 auth-db.test.json，避免污染开发用 auth-db.json */
export function resolveAuthDbFileForTests() {
  const dir = path.resolve(process.cwd(), 'server', 'data');
  const name =
    process.env.VITEST === 'true' || process.env.NODE_ENV === 'test' ? 'auth-db.test.json' : 'auth-db.json';
  return path.join(dir, name);
}
