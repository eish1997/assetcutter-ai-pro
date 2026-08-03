#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const shouldPublish = args.has('--publish');
const strict = args.has('--strict');

function readArg(name, fallback = '') {
  const prefix = `${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function run(label, command, commandArgs, options = {}) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
    ...options,
  });
  if (result.error) {
    console.error(result.error.message);
    return false;
  }
  return result.status === 0;
}

function hasEnv(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function main() {
  const authBase = readArg('--auth-base', process.env.AUTH_API_BASE || 'https://assetcutter-auth-api.onrender.com');
  const cookie = readArg('--cookie', process.env.COMPANION_ADMIN_COOKIE || '');
  const productionArgs = ['run', 'companion:codex-production-check', '--', `--auth-base=${authBase}`];
  if (cookie) productionArgs.push(`--cookie=${cookie}`);
  if (strict) productionArgs.push('--strict');

  console.log('Codex one-click production finalizer');
  console.log(`authBase: ${authBase}`);
  console.log(`publish: ${shouldPublish}`);
  console.log(`adminCookie: ${cookie ? 'present' : 'missing'}`);
  console.log(`sharedAuthEnv: ${hasEnv('CODEX_SHARED_AUTH_JSON_BASE64') || hasEnv('CODEX_SHARED_AUTH_JSON') ? 'present' : 'missing'}`);

  let ok = true;
  ok = run('Prepare desktop upload manifest', 'npm', ['run', 'companion:desktop-upload-manifest']) && ok;
  ok = run('Validate desktop publish payload', 'npm', ['run', 'companion:desktop-publish', '--', '--dry-run', `--auth-base=${authBase}`]) && ok;
  ok = run('Check production path', 'npm', productionArgs) && ok;

  if (shouldPublish) {
    if (!cookie) {
      console.error('\nMissing admin cookie. Set COMPANION_ADMIN_COOKIE or pass --cookie=...');
      process.exitCode = 1;
      return;
    }
    ok = run('Publish desktop installer and register artifact', 'npm', [
      'run',
      'companion:desktop-publish',
      '--',
      `--auth-base=${authBase}`,
      `--cookie=${cookie}`,
    ]) && ok;
    ok = run('Verify production after publish', 'npm', productionArgs) && ok;
  }

  console.log(ok ? '\nResult: finalizer checks completed.' : '\nResult: attention needed before production is ready.');
  process.exitCode = ok ? 0 : 1;
}

main();
