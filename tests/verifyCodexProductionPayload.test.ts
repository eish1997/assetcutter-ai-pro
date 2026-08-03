import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('missing server port'));
      else resolve(address.port);
    });
  });
}

function runProductionCheck(authBase: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        path.join(ROOT, 'scripts/verify-codex-one-click-production.mjs'),
        `--auth-base=${authBase}`,
        '--desktop-version=0.2.12',
        '--cookie=ac_session=test',
        '--json',
      ],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('Codex production payload verifier', () => {
  it('fails a logged-in Codex auth route that returns an invalid payload', async () => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === '/api/team/codex/auth') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authJsonBase64: 'not-base64-json' }));
        return;
      }
      if (url.pathname === '/api/companion-artifacts/electron-updater/win32/stable/latest.yml') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('version: 0.2.12\n');
        return;
      }
      if (url.pathname === '/api/companion-artifacts/latest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          latest: {
            semver: '0.2.12',
            fileName: 'AssetCutterCompanion-0.2.12-test-x64.exe',
            notes: [
              '#cleanMachineAcceptance:required',
              '#cleanMachineAcceptanceScriptR2Key:public/companion-distribution/test.ps1',
              '#cleanMachineAcceptanceBundleR2Key:public/companion-distribution/test-clean-machine.zip',
              '#cleanMachineAcceptanceBundleFiles:AssetCutterCompanion-0.2.12-test-x64.exe,verify-codex-clean-machine.ps1,README-clean-machine.txt',
              '#cleanMachineAcceptanceLocalCommand:powershell -File .\\verify-codex-clean-machine.ps1',
              '#cleanMachineAcceptancePostInstallCommand:powershell -File .\\verify-codex-clean-machine.ps1',
              '#cleanMachineAcceptanceReportGlob:codex-clean-machine-report-*.json',
            ].join('\n'),
          },
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const port = await listen(server);
    try {
      const result = await runProductionCheck(`http://127.0.0.1:${port}`);
      expect(result.code).toBe(1);
      const parsed = JSON.parse(result.stdout);
      const payload = parsed.results.find((item: { id?: string }) => item.id === 'codex_auth_payload');
      expect(payload.level).toBe('fail');
      expect(payload.detail).toContain('Unexpected token');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('warns when the latest desktop artifact lacks clean-machine acceptance metadata', async () => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === '/api/team/codex/auth') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authJson: { tokens: {}, auth_mode: 'test' } }));
        return;
      }
      if (url.pathname === '/api/companion-artifacts/electron-updater/win32/stable/latest.yml') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('version: 0.2.12\n');
        return;
      }
      if (url.pathname === '/api/companion-artifacts/latest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          latest: {
            semver: '0.2.12',
            fileName: 'AssetCutterCompanion-0.2.12-test-x64.exe',
            notes: 'missing acceptance notes',
          },
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const port = await listen(server);
    try {
      const result = await runProductionCheck(`http://127.0.0.1:${port}`);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      const metadata = parsed.results.find((item: { id?: string }) => item.id === 'desktop_artifact_clean_machine_acceptance');
      expect(metadata.level).toBe('warn');
      expect(metadata.detail).toContain('latest artifact notes missing');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
