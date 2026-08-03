#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const json = args.has('--json');

function readArg(name, fallback = '') {
  const prefix = `${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function check(id, label, level, detail = '') {
  return { id, label, level, detail };
}

function commandVersion(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 15000,
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error) return { ok: false, detail: result.error.message };
  return { ok: result.status === 0, detail: out || `exited ${result.status}` };
}

function request(url, headers = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({ ok: false, status: 0, detail: error.message });
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, { method: 'GET', headers, timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8').slice(0, 500);
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, detail: body });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (error) => {
      resolve({ ok: false, status: 0, detail: error.message });
    });
    req.end();
  });
}

function codexAuthPath() {
  const root = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(root, 'auth.json');
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function envExampleContainsCodexKeys() {
  const file = path.join(repoRoot(), '.env.example');
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  return text.includes('CODEX_SHARED_AUTH_JSON_BASE64') && text.includes('CODEX_SHARED_AUTH_JSON');
}

function desktopPackageIncludesCodexSetupFiles() {
  const file = path.join(repoRoot(), 'companion-desktop', 'package.json');
  if (!fs.existsSync(file)) return { ok: false, detail: 'companion-desktop/package.json not found' };
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const files = Array.isArray(pkg.build?.files) ? pkg.build.files.map(String) : [];
  const required = [
    'main.cjs',
    'preload-shell.cjs',
    'codex-auth-sync.cjs',
    'codex-mcp-config.cjs',
    'agent-store.cjs',
    'brain-adapters/**/*',
    'shell/**/*',
  ];
  const missing = required.filter((entry) => !files.includes(entry));
  return {
    ok: missing.length === 0,
    detail: missing.length ? `missing ${missing.join(', ')}` : 'required desktop files are included',
  };
}

async function main() {
  const results = [];
  const companionUrl = readArg('--companion-url', process.env.COMPANION_HEALTH_URL || 'http://127.0.0.1:18765/v1/health');
  const authUrl = readArg('--auth-url', process.env.CODEX_SHARED_AUTH_CHECK_URL || '');
  const cookie = readArg('--cookie', process.env.CODEX_SHARED_AUTH_CHECK_COOKIE || '');

  const health = await request(companionUrl);
  results.push(check(
    'local_companion',
    'Local companion health',
    health.ok ? 'ok' : 'warn',
    health.ok ? `${companionUrl} returned ${health.status}` : `${companionUrl} is not reachable: ${health.detail}`,
  ));

  const node = commandVersion('node');
  results.push(check('node', 'Node.js runtime', node.ok ? 'ok' : 'warn', node.detail));

  const npm = commandVersion('npm');
  results.push(check('npm', 'npm package manager', npm.ok ? 'ok' : 'warn', npm.detail));

  const codex = commandVersion('codex');
  results.push(check('codex_cli', 'Codex CLI', codex.ok ? 'ok' : 'warn', codex.detail));

  const authFile = codexAuthPath();
  results.push(check(
    'codex_auth_file',
    'Local Codex identity file',
    fs.existsSync(authFile) ? 'ok' : 'warn',
    fs.existsSync(authFile) ? authFile : `${authFile} is missing; one-click setup should pull it after login`,
  ));

  const envReady = Boolean(process.env.CODEX_SHARED_AUTH_JSON_BASE64 || process.env.CODEX_SHARED_AUTH_JSON);
  results.push(check(
    'cloud_auth_env',
    'Cloud shared Codex identity env',
    envReady ? 'ok' : 'warn',
    envReady ? 'Configured in current environment' : 'Not configured in current environment',
  ));

  results.push(check(
    'env_example',
    '.env.example documents Codex identity keys',
    envExampleContainsCodexKeys() ? 'ok' : 'fail',
    envExampleContainsCodexKeys() ? 'Required keys are present' : 'Missing CODEX_SHARED_AUTH_JSON keys',
  ));

  const packageFiles = desktopPackageIncludesCodexSetupFiles();
  results.push(check(
    'desktop_package_files',
    'Desktop package includes Codex setup files',
    packageFiles.ok ? 'ok' : 'fail',
    packageFiles.detail,
  ));

  if (authUrl) {
    const headers = cookie ? { Cookie: cookie } : {};
    const auth = await request(authUrl, headers);
    const routeExistsWithoutCookie = !cookie && (auth.status === 401 || auth.status === 503);
    const level = auth.ok || routeExistsWithoutCookie ? 'ok' : auth.status === 401 || auth.status === 503 ? 'warn' : 'fail';
    const routeDetail = auth.ok
      ? `${authUrl} returned ${auth.status}`
      : routeExistsWithoutCookie
        ? `${authUrl} returned ${auth.status}; route exists, login or shared identity is required`
        : `${authUrl} returned ${auth.status || 'network error'}: ${auth.detail}`;
    results.push(check(
      'cloud_auth_route',
      'Cloud Codex identity route',
      level,
      routeDetail,
    ));
  } else {
    results.push(check(
      'cloud_auth_route',
      'Cloud Codex identity route',
      'warn',
      'Skipped; pass --auth-url=https://.../api/team/codex/auth with --cookie=... for a live route check',
    ));
  }

  const failed = results.filter((item) => item.level === 'fail');
  const warned = results.filter((item) => item.level === 'warn');
  const exitCode = failed.length || (strict && warned.length) ? 1 : 0;

  if (json) {
    console.log(JSON.stringify({ ok: exitCode === 0, strict, results }, null, 2));
  } else {
    console.log('Codex one-click readiness check');
    for (const item of results) {
      const mark = item.level === 'ok' ? 'OK' : item.level === 'warn' ? 'WARN' : 'FAIL';
      console.log(`[${mark}] ${item.label}: ${item.detail}`);
    }
    console.log(exitCode === 0 ? 'Result: ready enough for this mode.' : 'Result: attention needed before release.');
  }

  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
