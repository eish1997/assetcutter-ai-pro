import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runCheck(envFile: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['scripts/validate-codex-shared-auth-env.mjs', `--env-file=${envFile}`, '--json'],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('Codex shared auth env validator', () => {
  it('accepts a base64 encoded Codex auth JSON object', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-codex-auth-env-'));
    const envFile = path.join(dir, '.env.codex-shared-auth.local');
    const base64 = Buffer.from(JSON.stringify({ OPENAI_API_KEY: 'test' }), 'utf8').toString('base64');
    fs.writeFileSync(envFile, `CODEX_SHARED_AUTH_JSON_BASE64=${base64}\n`, 'utf8');

    const result = await runCheck(envFile);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.mode).toBe('base64');
    expect(parsed.topLevelKeys).toContain('OPENAI_API_KEY');
  });

  it('rejects missing or malformed Codex auth env values', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-codex-auth-env-'));
    const envFile = path.join(dir, '.env.codex-shared-auth.local');
    fs.writeFileSync(envFile, 'CODEX_SHARED_AUTH_JSON_BASE64=not-json\n', 'utf8');

    const result = await runCheck(envFile);
    expect(result.code).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeTruthy();
  });
});
