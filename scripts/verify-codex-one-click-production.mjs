#!/usr/bin/env node

import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const strict = args.has('--strict');

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

function readDesktopVersion() {
  const pkgPath = path.resolve(process.cwd(), 'companion-desktop', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return String(pkg.version || '').trim();
  } catch {
    return '';
  }
}

function buildUrl(base, suffix) {
  return `${String(base || '').replace(/\/+$/, '')}${suffix}`;
}

function request(url, headers = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({ ok: false, status: 0, body: '', detail: error.message });
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, { method: 'GET', headers, timeout: 20000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body,
          detail: body.slice(0, 500),
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ ok: false, status: 0, body: '', detail: error.message }));
    req.end();
  });
}

function result(id, label, level, detail) {
  return { id, label, level, detail };
}

function validateCodexAuthPayload(body) {
  let payload;
  try {
    payload = JSON.parse(String(body || ''));
  } catch (error) {
    return { ok: false, error: `payload is not JSON: ${error && error.message ? error.message : String(error)}` };
  }
  let value = payload;
  try {
    if (value && typeof value === 'object' && value.authJsonBase64) {
      value = Buffer.from(String(value.authJsonBase64), 'base64').toString('utf8');
    } else if (value && typeof value === 'object' && value.authJson != null) {
      value = value.authJson;
    }
    if (typeof value === 'string') value = JSON.parse(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'auth payload does not contain a JSON object' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
}

function validateCleanMachineAcceptanceNotes(body, desktopVersion) {
  let payload;
  try {
    payload = JSON.parse(String(body || ''));
  } catch (error) {
    return { ok: false, error: `latest artifact response is not JSON: ${error && error.message ? error.message : String(error)}` };
  }
  const latest = payload && payload.latest && typeof payload.latest === 'object' ? payload.latest : null;
  if (!latest) return { ok: false, error: 'latest artifact is missing' };
  const semver = String(latest.semver || '').trim();
  if (desktopVersion && semver !== desktopVersion) {
    return { ok: false, error: `latest artifact semver is ${semver || 'missing'}, expected ${desktopVersion}` };
  }
  const notes = String(latest.notes || '');
  const required = [
    '#cleanMachineAcceptance:required',
    '#cleanMachineAcceptanceScriptR2Key:',
    '#cleanMachineAcceptanceBundleR2Key:',
    '#cleanMachineAcceptanceBundleFiles:',
    'README-clean-machine.txt',
    '#cleanMachineAcceptanceLocalCommand:',
    '#cleanMachineAcceptancePostInstallCommand:',
    '#cleanMachineAcceptanceReportGlob:codex-clean-machine-report-*.json',
  ];
  const missing = required.filter((needle) => !notes.includes(needle));
  if (missing.length) return { ok: false, error: `latest artifact notes missing ${missing.join(', ')}` };
  return { ok: true, fileName: latest.fileName || '', semver };
}

async function main() {
  const authBase = readArg('--auth-base', process.env.AUTH_API_BASE || 'https://assetcutter-auth-api.onrender.com');
  const cookie = readArg('--cookie', process.env.CODEX_SHARED_AUTH_CHECK_COOKIE || '');
  const desktopVersion = readArg('--desktop-version', readDesktopVersion());
  const results = [];

  const healthUrl = buildUrl(authBase, '/healthz');
  const health = await request(healthUrl);
  results.push(result(
    'auth_health',
    'auth-api health',
    health.ok ? 'ok' : 'fail',
    health.ok ? `${healthUrl} returned ${health.status}` : `${healthUrl} returned ${health.status || 'network error'}: ${health.detail}`,
  ));

  const authUrl = buildUrl(authBase, '/api/team/codex/auth');
  const unauth = await request(authUrl);
  const routeExists = unauth.ok || unauth.status === 401 || unauth.status === 503;
  results.push(result(
    'codex_auth_route',
    'Codex identity route exists',
    routeExists ? 'ok' : 'fail',
    routeExists
      ? `${authUrl} returned ${unauth.status}; ${unauth.status === 401 ? 'login required' : unauth.status === 503 ? 'shared identity not configured' : 'route ready'}`
      : `${authUrl} returned ${unauth.status || 'network error'}: ${unauth.detail}`,
  ));

  if (cookie) {
    const authed = await request(authUrl, { Cookie: cookie });
    const payloadCheck = authed.ok ? validateCodexAuthPayload(authed.body) : { ok: false, error: authed.detail };
    results.push(result(
      'codex_auth_payload',
      'Codex identity payload with login',
      authed.ok && payloadCheck.ok ? 'ok' : 'fail',
      authed.ok && payloadCheck.ok
        ? `${authUrl} returned 200 with a valid Codex auth payload`
        : `${authUrl} returned ${authed.status || 'network error'}: ${payloadCheck.error || authed.detail}`,
    ));
  } else {
    results.push(result(
      'codex_auth_payload',
      'Codex identity payload with login',
      'warn',
      'Skipped; pass --cookie=... to verify logged-in payload returns 200',
    ));
  }

  const feedUrl = buildUrl(authBase, '/api/companion-artifacts/electron-updater/win32/stable/latest.yml');
  const feed = await request(feedUrl);
  const feedHasVersion = Boolean(feed.ok && desktopVersion && feed.body.includes(desktopVersion));
  results.push(result(
    'desktop_update_feed',
    'Desktop update feed contains target version',
    feedHasVersion ? 'ok' : feed.ok ? 'warn' : 'fail',
    feed.ok
      ? feedHasVersion
        ? `${feedUrl} includes ${desktopVersion}`
        : `${feedUrl} returned ${feed.status}, but does not include ${desktopVersion || 'target version'}`
      : `${feedUrl} returned ${feed.status || 'network error'}: ${feed.detail}`,
  ));

  const latestUrl = buildUrl(authBase, '/api/companion-artifacts/latest?kind=desktop_shell&platform=win32&channel=stable');
  const latest = await request(latestUrl);
  const latestCheck = latest.ok
    ? validateCleanMachineAcceptanceNotes(latest.body, desktopVersion)
    : { ok: false, error: latest.detail };
  results.push(result(
    'desktop_artifact_clean_machine_acceptance',
    'Desktop artifact carries clean-machine acceptance metadata',
    latest.ok && latestCheck.ok ? 'ok' : latest.ok ? 'warn' : 'fail',
    latest.ok && latestCheck.ok
      ? `${latestUrl} returned ${latest.status}; ${latestCheck.fileName || desktopVersion} carries clean-machine acceptance metadata`
      : latest.ok
        ? `${latestUrl} returned ${latest.status}, but ${latestCheck.error}`
        : `${latestUrl} returned ${latest.status || 'network error'}: ${latest.detail}`,
  ));

  const failed = results.filter((item) => item.level === 'fail');
  const warned = results.filter((item) => item.level === 'warn');
  const exitCode = failed.length || (strict && warned.length) ? 1 : 0;

  if (json) {
    console.log(JSON.stringify({ ok: exitCode === 0, authBase, desktopVersion, results }, null, 2));
  } else {
    console.log('Codex one-click production verification');
    for (const item of results) {
      const mark = item.level === 'ok' ? 'OK' : item.level === 'warn' ? 'WARN' : 'FAIL';
      console.log(`[${mark}] ${item.label}: ${item.detail}`);
    }
    console.log(exitCode === 0 ? 'Result: production path is ready for this mode.' : 'Result: production path still needs attention.');
  }
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
