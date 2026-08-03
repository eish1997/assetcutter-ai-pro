#!/usr/bin/env node

import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const strict = args.has('--strict');

function readArg(name, fallback = '') {
  const prefix = `${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
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
    results.push(result(
      'codex_auth_payload',
      'Codex identity payload with login',
      authed.ok ? 'ok' : 'fail',
      authed.ok ? `${authUrl} returned 200 with logged-in cookie` : `${authUrl} returned ${authed.status || 'network error'}: ${authed.detail}`,
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
