import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`port ${port} not open within ${timeoutMs}ms`));
          return;
        }
        setTimeout(tick, 50);
      });
    };
    tick();
  });
}

async function waitForStoreReady(port: number, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = (await res.json()) as { ok?: boolean; ready?: boolean; service?: string };
    if (res.status === 200 && body.ready === true) return body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('store not ready in time');
}

function spawnAuthApi(port: number, envOverrides: Record<string, string> = {}): ChildProcess {
  return spawn(process.execPath, [path.join(ROOT, 'server/auth-api.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      AUTH_BIND_HOST: '127.0.0.1',
      BRIDGE_REQUIRE_AUTH: 'false',
      NODE_ENV: 'test',
      DATABASE_URL: '',
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function stopChild(child: ChildProcess) {
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      resolve();
    }, 2000);
  });
}

describe('auth-api startup', () => {
  it('opens port before store init finishes and never returns Service starting', async () => {
    const port = 19_000 + Math.floor(Math.random() * 800);
    const child = spawnAuthApi(port);

    try {
      await waitForPort(port, 10_000);

      const healthEarly = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(healthEarly.status).toBe(200);
      const healthBody = (await healthEarly.json()) as { service?: string };
      expect(healthBody.service).toBe('auth-api');

      const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5173',
        },
        body: JSON.stringify({ identifier: 'nobody', password: 'wrong-password' }),
      });
      const loginText = await loginRes.text();
      expect(loginText).not.toContain('Service starting');
      expect(loginRes.status).not.toBe(503);
      expect(loginRes.status).toBe(401);

      const ready = await waitForStoreReady(port, 10_000);
      expect(ready.ok).toBe(true);
      expect(ready.ready).toBe(true);
    } finally {
      await stopChild(child);
    }
  }, 30_000);

  it('does not fall back to an empty JSON auth store when production Postgres is unavailable', async () => {
    const port = 19_900 + Math.floor(Math.random() * 500);
    const child = spawnAuthApi(port, {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/missing',
      AUTH_ALLOWED_ORIGINS: 'https://assetcutter-ai-pro.vercel.app',
      AUTH_COOKIE_SAMESITE: 'none',
      AUTH_COOKIE_SECURE: 'true',
      AUTH_STORE_ALLOW_JSON_FALLBACK: 'false',
      AUTH_STORE_INIT_TIMEOUT_MS: '2500',
      PG_CONNECTION_TIMEOUT_MS: '500',
      PG_QUERY_TIMEOUT_MS: '500',
      PG_STATEMENT_TIMEOUT_MS: '500',
      PG_LOCK_TIMEOUT_MS: '500',
    });

    try {
      await waitForPort(port, 10_000);
      const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://assetcutter-ai-pro.vercel.app',
        },
        body: JSON.stringify({ identifier: 'existing-user', password: 'wrong-password' }),
      });
      const body = (await loginRes.json()) as { error?: string };
      expect(loginRes.status).toBe(503);
      expect(String(body.error || '')).toContain('Postgres unavailable');
    } finally {
      await stopChild(child);
    }
  }, 30_000);
});
