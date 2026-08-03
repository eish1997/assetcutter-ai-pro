import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let server: http.Server | null = null;

function listen(handler: http.RequestListener): Promise<{ baseUrl: string }> {
  server = http.createServer(handler);
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (!address || typeof address === 'string') throw new Error('missing address');
      resolve({ baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function runScript(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/apply-codex-shared-auth-to-render.mjs', ...args], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RENDER_API_KEY: 'test-render-key' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

afterEach(() => {
  if (server) server.close();
  server = null;
});

describe('apply Codex shared auth to Render', () => {
  function writeEnvFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-render-codex-auth-'));
    const envFile = path.join(dir, '.env.codex-shared-auth.local');
    const base64 = Buffer.from(JSON.stringify({ OPENAI_API_KEY: 'secret-value' }), 'utf8').toString('base64');
    fs.writeFileSync(
      envFile,
      `CODEX_SHARED_AUTH_JSON_BASE64=${base64}\nCODEX_SHARED_AUTH_UPDATED_AT=2026-08-03T00:00:00.000Z\n`,
      'utf8',
    );
    return { envFile, base64 };
  }

  it('updates Render env vars and triggers deploy without printing secret values', async () => {
    const { envFile, base64 } = writeEnvFile();
    const calls: Array<{ method?: string; url?: string; body: string }> = [];
    const { baseUrl } = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        calls.push({ method: req.method, url: req.url, body });
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET' && req.url?.startsWith('/v1/services')) {
          res.end(JSON.stringify([{ service: { id: 'srv_auth', name: 'assetcutter-auth-api' } }]));
          return;
        }
        if (req.method === 'PUT' && req.url?.startsWith('/v1/services/srv_auth/env-vars/')) {
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.method === 'POST' && req.url === '/v1/services/srv_auth/deploys') {
          res.end(JSON.stringify({ id: 'dep_1' }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
      });
    });

    const result = await runScript([
      `--api-base=${baseUrl}`,
      `--env-file=${envFile}`,
      '--apply',
      '--deploy',
      '--json',
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain(base64);
    expect(result.stdout).not.toContain('secret-value');
    expect(calls.some((call) => call.method === 'GET' && call.url?.startsWith('/v1/services?name='))).toBe(true);
    expect(calls.some((call) => call.method === 'PUT' && call.url?.includes('/CODEX_SHARED_AUTH_JSON_BASE64'))).toBe(true);
    expect(calls.some((call) => call.method === 'PUT' && call.url?.includes('/CODEX_SHARED_AUTH_UPDATED_AT'))).toBe(true);
    expect(calls.some((call) => call.method === 'POST' && call.url === '/v1/services/srv_auth/deploys')).toBe(true);
  });

  it('waits for a triggered Render deploy to become live', async () => {
    const { envFile } = writeEnvFile();
    let deployChecks = 0;
    const { baseUrl } = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET' && req.url?.startsWith('/v1/services?name=')) {
          res.end(JSON.stringify({ data: [{ service: { id: 'srv_auth', name: 'assetcutter-auth-api' } }] }));
          return;
        }
        if (req.method === 'PUT' && req.url?.startsWith('/v1/services/srv_auth/env-vars/')) {
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.method === 'POST' && req.url === '/v1/services/srv_auth/deploys') {
          res.end(JSON.stringify({ id: 'dep_1', status: 'created' }));
          return;
        }
        if (req.method === 'GET' && req.url === '/v1/services/srv_auth/deploys/dep_1') {
          deployChecks += 1;
          res.end(JSON.stringify({ deploy: { id: 'dep_1', status: deployChecks > 1 ? 'live' : 'created' } }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
      });
    });

    const result = await runScript([
      `--api-base=${baseUrl}`,
      `--env-file=${envFile}`,
      '--apply',
      '--deploy',
      '--wait-deploy',
      '--deploy-poll-ms=1',
      '--deploy-timeout-ms=5000',
      '--json',
    ]);

    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.deploy.wait.ok).toBe(true);
    expect(parsed.deploy.wait.deployStatus).toBe('live');
    expect(deployChecks).toBeGreaterThanOrEqual(2);
  });

  it('accepts Render service list responses wrapped in data', async () => {
    const { envFile } = writeEnvFile();
    const { baseUrl } = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET' && req.url?.startsWith('/v1/services')) {
          res.end(JSON.stringify({ data: [{ service: { id: 'srv_auth', name: 'assetcutter-auth-api' } }] }));
          return;
        }
        if (req.method === 'PUT' && req.url?.startsWith('/v1/services/srv_auth/env-vars/')) {
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
      });
    });

    const result = await runScript([
      `--api-base=${baseUrl}`,
      `--env-file=${envFile}`,
      '--apply',
      '--json',
    ]);

    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.serviceId).toBe('srv_auth');
    expect(parsed.applied).toHaveLength(2);
  });
});
