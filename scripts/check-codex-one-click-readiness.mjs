#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const json = args.has('--json');
const conversationSmoke = args.has('--conversation-smoke');
const require = createRequire(import.meta.url);
const FORBIDDEN_EXTERNAL_AGENT_PATTERNS = [
  /(^|\/)hermes[^/]*\.cjs$/i,
  /(^|\/)hermes-bootstrap\//i,
  /(^|\/)companion-connect\.cjs$/i,
  /(^|\/)brain-adapters\/(hermes|openai_compat|claude_code)\.cjs$/i,
];

function readArg(name, fallback = '') {
  const argv = process.argv.slice(2);
  const prefix = `${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !String(argv[index + 1]).startsWith('--')) {
    return argv[index + 1];
  }
  return fallback;
}

function check(id, label, level, detail = '') {
  return { id, label, level, detail };
}

function commandVersion(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 15000,
    env: setupCommandEnv(setupToolPathDirs()),
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error) return { ok: false, detail: result.error.message };
  return { ok: result.status === 0, detail: out || `exited ${result.status}`, command };
}

function setupToolPathDirs() {
  if (process.platform !== 'win32') return [];
  const dirs = [];
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  const appData = String(process.env.APPDATA || '');
  const programFiles = String(process.env.ProgramFiles || 'C:\\Program Files');
  const programFilesX86 = String(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)');
  if (localAppData) {
    dirs.push(path.join(localAppData, 'AssetCutterCompanion', 'sandbox', 'runtimes', 'codex-npm-global'));
    const portableRoot = path.join(localAppData, 'AssetCutterCompanion', 'sandbox', 'runtimes', 'codex-node');
    if (fs.existsSync(portableRoot)) {
      for (const entry of fs.readdirSync(portableRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && /^node-v/i.test(entry.name)) dirs.push(path.join(portableRoot, entry.name));
      }
    }
  }
  if (appData) dirs.push(path.join(appData, 'npm'));
  dirs.push(path.join(programFiles, 'nodejs'));
  dirs.push(path.join(programFilesX86, 'nodejs'));
  return dirs;
}

function setupCommandEnv(extraPaths) {
  const env = { ...process.env };
  const paths = Array.isArray(extraPaths) ? extraPaths.filter(Boolean).map(String) : [];
  if (!paths.length) return env;
  const pathKey = Object.prototype.hasOwnProperty.call(env, 'Path') ? 'Path' : 'PATH';
  const current = String(env[pathKey] || env.PATH || '');
  const existing = current.split(path.delimiter).filter(Boolean);
  const seen = new Set(existing.map((item) => item.toLowerCase()));
  const merged = [...existing];
  for (const item of paths) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.unshift(item);
  }
  env[pathKey] = merged.join(path.delimiter);
  if (pathKey !== 'PATH') env.PATH = env[pathKey];
  return env;
}

function knownWindowsCommandPaths(name) {
  if (process.platform !== 'win32') return [];
  const lower = String(name || '').toLowerCase();
  const file = lower === 'node' ? 'node.exe' : lower.endsWith('.cmd') ? name : `${name}.cmd`;
  return setupToolPathDirs().map((dir) => path.join(dir, file));
}

function commandVersionWithKnownPaths(name, args = ['--version']) {
  const defaultCommand = process.platform === 'win32' && String(name).toLowerCase() !== 'node' ? `${name}.cmd` : name;
  const direct = commandVersion(defaultCommand, args);
  if (direct.ok || process.platform !== 'win32') return direct;
  for (const candidate of knownWindowsCommandPaths(name)) {
    if (!fs.existsSync(candidate)) continue;
    const probe = commandVersion(candidate, args);
    if (probe.ok) return { ...probe, detail: `${probe.detail} (${candidate})` };
  }
  return direct;
}

function resolveCodexCommandForSmoke() {
  const probe = commandVersionWithKnownPaths('codex');
  return probe.ok ? probe.command : (process.platform === 'win32' ? 'codex.cmd' : 'codex');
}

function codexConversationSmokeTest() {
  const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-codex-readiness-'));
  const prompt = 'Reply with exactly: assetcutter-codex-ready';
  const codexCommand = resolveCodexCommandForSmoke();
  try {
    const result = spawnSync(
      codexCommand,
      [
        'exec',
        '--json',
        '--color',
        'never',
        '--disable',
        'plugins',
        '--ignore-rules',
        '--skip-git-repo-check',
        '-C',
        smokeDir,
        '-',
      ],
      {
        input: prompt,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 120000,
        env: setupCommandEnv(setupToolPathDirs()),
      },
    );
    const out = `${result.stdout || ''}`.trim();
    const err = `${result.stderr || ''}`.trim();
    if (result.error) return { ok: false, detail: result.error.message };
    const text = out
      .split(/\r?\n/)
      .map((line) => {
        try {
          const event = JSON.parse(line);
          return event && event.item && event.item.type === 'agent_message' ? String(event.item.text || '') : '';
        } catch {
          return '';
        }
      })
      .filter(Boolean)
      .join('\n')
      .trim();
    const ok = result.status === 0 && text.toLowerCase().includes('assetcutter-codex-ready');
    return {
      ok,
      detail: ok
        ? `Codex completed a real test conversation via ${codexCommand}`
        : (text || err || `codex exited ${result.status}`),
    };
  } finally {
    fs.rmSync(smokeDir, { recursive: true, force: true });
  }
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
    'brain-adapters/index.cjs',
    'brain-adapters/stub.cjs',
    'brain-adapters/codex.cjs',
    'shell/**/*',
  ];
  const missing = required.filter((entry) => !files.includes(entry));
  const forbidden = [
    'hermes-official-host.cjs',
    'hermes-cli-resolve.cjs',
    'hermes-gateway-host.cjs',
    'companion-connect.cjs',
    'brain-adapters/hermes.cjs',
    'brain-adapters/openai_compat.cjs',
    'brain-adapters/claude_code.cjs',
  ].filter((entry) => files.includes(entry));
  const resources = Array.isArray(pkg.build?.extraResources) ? pkg.build.extraResources : [];
  const forbiddenResources = resources
    .map((entry) => `${entry && entry.from ? String(entry.from) : ''} ${entry && entry.to ? String(entry.to) : ''}`)
    .filter((entry) => /hermes/i.test(entry));
  return {
    ok: missing.length === 0 && forbidden.length === 0 && forbiddenResources.length === 0,
    detail: missing.length
      ? `missing ${missing.join(', ')}`
      : forbidden.length
        ? `forbidden external agent files included: ${forbidden.join(', ')}`
        : forbiddenResources.length
          ? `forbidden external agent resources included: ${forbiddenResources.join(', ')}`
          : 'required Codex-only desktop files are included',
  };
}

function readDesktopVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot(), 'companion-desktop', 'package.json'), 'utf8'));
    return String(pkg.version || '').trim();
  } catch {
    return '';
  }
}

function builtDesktopAsarIsCodexOnly() {
  const version = readDesktopVersion();
  if (!version) return { level: 'warn', detail: 'companion-desktop/package.json version not found' };
  const asarPath = path.join(
    repoRoot(),
    'companion-desktop',
    `dist-out-${version.replace(/\./g, '')}`,
    'installer',
    'win-unpacked',
    'resources',
    'app.asar',
  );
  if (!fs.existsSync(asarPath)) {
    return { level: 'warn', detail: `app.asar not found at ${asarPath}; build release package to scan installer contents` };
  }
  try {
    const asar = require('../companion-desktop/node_modules/@electron/asar');
    const files = asar.listPackage(asarPath).map((entry) => String(entry || '').replace(/\\/g, '/').replace(/^\/+/, ''));
    const forbidden = files.filter((file) => FORBIDDEN_EXTERNAL_AGENT_PATTERNS.some((pattern) => pattern.test(file)));
    if (forbidden.length) {
      return { level: 'fail', detail: `built app.asar still contains non-Codex agent files: ${forbidden.join(', ')}` };
    }
    return { level: 'ok', detail: 'built app.asar contains Codex-only agent files' };
  } catch (error) {
    return { level: 'warn', detail: error instanceof Error ? error.message : String(error) };
  }
}

function agentSettingsUiIsCodexOnly() {
  const files = [
    path.join(repoRoot(), 'index.html'),
    path.join(repoRoot(), 'companion-desktop', 'shell', 'index.html'),
  ];
  const forbidden = [
    'btnHermesOneClickSetup',
    'btnHermesConnectExisting',
    'hermesGatewaySetup',
    'companionConnect',
    'openai_compat',
    'claude_code',
    'npm run agent:init',
    'npm run agent:cli',
    'Hermes / Claude',
  ];
  const hits = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      hits.push(`${path.relative(repoRoot(), file)} missing`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const needle of forbidden) {
      if (text.includes(needle)) hits.push(`${path.relative(repoRoot(), file)} contains ${needle}`);
    }
  }
  return {
    ok: hits.length === 0,
    detail: hits.length ? hits.join('; ') : 'web and desktop Agent settings expose Codex-only controls',
  };
}

function desktopOneClickHasCleanMachineFallbacks() {
  const file = path.join(repoRoot(), 'companion-desktop', 'main.cjs');
  if (!fs.existsSync(file)) return { ok: false, detail: 'companion-desktop/main.cjs not found' };
  const text = fs.readFileSync(file, 'utf8');
  const required = [
    'installNodeRuntimeForSetup',
    'installNodeFromOfficialMsiForSetup',
    'installPortableNodeForSetup',
    'fetchTextViaPowerShellForSetup',
    'downloadFileViaPowerShellForSetup',
    'installCodexWithNpmForSetup',
    'install_codex_cli_portable',
    'codexNpmGlobalPrefixForSetup',
    'setupNpmGlobalEnv',
    'NPM_CONFIG_PREFIX',
    'codex-npm-global',
    'SHASUMS256.txt',
    'sha256_mismatch',
    'Invoke-WebRequest -Uri',
    'Expand-Archive',
    'msiexec.exe',
    "['install', '-g', '@openai/codex']",
  ];
  const missing = required.filter((needle) => !text.includes(needle));
  return {
    ok: missing.length === 0,
    detail: missing.length
      ? `missing clean-machine fallback markers: ${missing.join(', ')}`
      : 'one-click setup includes Node/npm/Codex clean-machine fallbacks',
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

  const node = commandVersionWithKnownPaths('node');
  results.push(check('node', 'Node.js runtime', node.ok ? 'ok' : 'warn', node.detail));

  const npm = commandVersionWithKnownPaths('npm');
  results.push(check('npm', 'npm package manager', npm.ok ? 'ok' : 'warn', npm.detail));

  const codex = commandVersionWithKnownPaths('codex');
  results.push(check('codex_cli', 'Codex CLI', codex.ok ? 'ok' : 'warn', codex.detail));

  if (conversationSmoke) {
    const smoke = codexConversationSmokeTest();
    results.push(check(
      'codex_conversation_smoke',
      'Codex real conversation smoke',
      smoke.ok ? 'ok' : 'fail',
      smoke.detail,
    ));
  } else {
    results.push(check(
      'codex_conversation_smoke',
      'Codex real conversation smoke',
      'warn',
      'Skipped; pass --conversation-smoke on a test machine to prove Codex can actually reply',
    ));
  }

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

  const asarScan = builtDesktopAsarIsCodexOnly();
  results.push(check(
    'desktop_built_asar_codex_only',
    'Built desktop package is Codex-only',
    asarScan.level,
    asarScan.detail,
  ));

  const uiCodexOnly = agentSettingsUiIsCodexOnly();
  results.push(check(
    'agent_settings_ui_codex_only',
    'Agent settings UI is Codex-only',
    uiCodexOnly.ok ? 'ok' : 'fail',
    uiCodexOnly.detail,
  ));

  const cleanMachineFallbacks = desktopOneClickHasCleanMachineFallbacks();
  results.push(check(
    'desktop_one_click_clean_machine_fallbacks',
    'Desktop one-click setup has clean-machine fallbacks',
    cleanMachineFallbacks.ok ? 'ok' : 'fail',
    cleanMachineFallbacks.detail,
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
