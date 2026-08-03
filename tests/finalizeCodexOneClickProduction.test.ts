import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runFinalizer(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'scripts/finalize-codex-one-click-production.mjs'), ...args],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('Codex production finalizer', () => {
  it('requires a clean-machine acceptance report before continuing when requested', async () => {
    const result = await runFinalizer(['--require-clean-machine', '--skip-local-smoke']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Missing clean-machine acceptance report');
    expect(result.stdout).toContain('Next clean-machine acceptance steps');
    expect(result.stdout).toContain('verify-codex-clean-machine.ps1 -LaunchInstaller -AutoCodexSetup -Strict');
    expect(result.stdout).toContain('--clean-machine-report=<report.json>');
    expect(result.stdout).not.toContain('Prepare desktop upload manifest');
    expect(result.stdout).not.toContain('Check production path');
  });

  it('validates a supplied clean-machine report after production publish checks', () => {
    const script = fs.readFileSync(path.join(ROOT, 'scripts/finalize-codex-one-click-production.mjs'), 'utf8');
    const productionCheck = script.indexOf("run('Check production path'");
    const publishCheck = script.indexOf("run('Verify production after publish (strict)'");
    const cleanMachineCheck = script.indexOf('Validate clean-machine acceptance report');
    expect(productionCheck).toBeGreaterThan(-1);
    expect(publishCheck).toBeGreaterThan(productionCheck);
    expect(cleanMachineCheck).toBeGreaterThan(publishCheck);
  });

  it('treats strict publish as requiring post-publish clean-machine acceptance', () => {
    const script = fs.readFileSync(path.join(ROOT, 'scripts/finalize-codex-one-click-production.mjs'), 'utf8');
    expect(script).toContain('const cleanMachineRequired = requireCleanMachine || (shouldPublish && strict)');
    expect(script).toContain('cleanMachineRequired && !cleanMachineReport && !shouldPublish');
    expect(script).toContain('printCleanMachineNextActions(authBase, desktopVersion)');
    const publishCheck = script.indexOf("run('Verify production after publish (strict)'");
    const missingReport = script.indexOf('Publish is not the final acceptance step');
    expect(missingReport).toBeGreaterThan(publishCheck);
  });

  it('reuses the publish cookie for Codex identity verification unless a separate auth cookie is provided', () => {
    const script = fs.readFileSync(path.join(ROOT, 'scripts/finalize-codex-one-click-production.mjs'), 'utf8');
    expect(script).toContain("const explicitAuthCheckCookie = readArg('--auth-cookie', process.env.CODEX_SHARED_AUTH_CHECK_COOKIE || '')");
    expect(script).toContain('const authCheckCookie = explicitAuthCheckCookie || adminCookie');
    expect(script).toContain('if (authCheckCookie) productionArgs.push(`--cookie=${authCheckCookie}`)');
  });
});
