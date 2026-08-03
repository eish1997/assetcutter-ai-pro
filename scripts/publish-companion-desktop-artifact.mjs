#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function readArg(name, fallback = '') {
  const prefix = `${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function buildUrl(base, suffix) {
  return `${String(base || '').replace(/\/+$/, '')}${suffix}`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readDesktopVersion() {
  const pkg = readJson(path.resolve('companion-desktop/package.json'));
  if (!pkg.version) throw new Error('Missing companion-desktop/package.json version');
  return String(pkg.version);
}

function defaultManifestPath() {
  const version = readDesktopVersion();
  return path.join('companion-desktop', `dist-out-${version.replace(/\./g, '')}`, 'installer', 'desktop-upload-manifest.json');
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const message = body && body.error ? String(body.error) : text || `HTTP ${res.status}`;
    const error = new Error(`${url} failed: HTTP ${res.status} ${message}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

function requireFile(file, label) {
  if (!file || !fs.existsSync(file)) throw new Error(`${label} not found: ${file || '(empty)'}`);
  return path.resolve(file);
}

function registrationPayload(manifest) {
  return {
    kind: manifest.kind,
    semver: manifest.semver,
    channel: manifest.channel,
    platform: manifest.platform,
    fileName: manifest.fileName,
    r2Key: manifest.r2Key,
    sha256: manifest.sha256,
    sha512: manifest.sha512,
    blockMapBytes: manifest.blockMapBytes,
    blockMapR2Key: manifest.blockMapR2Key,
    bytes: manifest.bytes,
    notes: manifest.notes,
    label: manifest.label,
  };
}

async function presign(base, cookie, fileName, contentType, objectKey) {
  return requestJson(buildUrl(base, '/api/admin/companion-artifacts/upload-url'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      fileName,
      contentType: contentType || 'application/octet-stream',
      ...(objectKey ? { objectKey } : {}),
    }),
  });
}

async function uploadFile(uploadUrl, file, contentType, dryRun) {
  const bytes = fs.readFileSync(file);
  if (dryRun) return { ok: true, skipped: true, bytes: bytes.length };
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType || 'application/octet-stream' },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`R2 upload failed for ${file}: HTTP ${res.status} ${await res.text()}`);
  }
  return { ok: true, bytes: bytes.length };
}

async function main() {
  const base = readArg('--auth-base', process.env.AUTH_API_BASE || 'https://assetcutter-auth-api.onrender.com');
  const cookie = readArg('--cookie', process.env.COMPANION_ADMIN_COOKIE || '');
  const dryRun = hasFlag('--dry-run');
  const manifestPath = path.resolve(readArg('--manifest', defaultManifestPath()));
  if (!cookie && !dryRun) {
    throw new Error('Missing admin cookie. Pass --cookie=... or set COMPANION_ADMIN_COOKIE. Use --dry-run to validate only.');
  }
  const manifest = readJson(manifestPath);
  const exePath = requireFile(manifest.filePath, 'installer');
  const blockMapPath = manifest.blockMapFilePath ? requireFile(manifest.blockMapFilePath, 'blockmap') : '';

  console.log('Companion desktop artifact publish');
  console.log(`authBase: ${base}`);
  console.log(`manifest: ${manifestPath}`);
  console.log(`version: ${manifest.semver}`);
  console.log(`dryRun: ${dryRun}`);

  if (dryRun) {
    console.log('Dry-run registration payload:');
    console.log(JSON.stringify(registrationPayload(manifest), null, 2));
    return;
  }

  const exePresign = await presign(base, cookie, manifest.fileName, manifest.contentType, manifest.r2Key);
  console.log(`upload installer -> ${exePresign.objectKey}`);
  await uploadFile(exePresign.uploadUrl, exePath, exePresign.contentType, false);

  let blockMapObjectKey = manifest.blockMapR2Key;
  if (blockMapPath) {
    const bmPresign = await presign(
      base,
      cookie,
      manifest.blockMapFileName || path.basename(blockMapPath),
      manifest.blockMapContentType,
      manifest.blockMapR2Key || `${exePresign.objectKey}.blockmap`,
    );
    blockMapObjectKey = bmPresign.objectKey;
    console.log(`upload blockmap -> ${bmPresign.objectKey}`);
    await uploadFile(bmPresign.uploadUrl, blockMapPath, bmPresign.contentType, false);
  }

  const payload = {
    ...registrationPayload(manifest),
    r2Key: exePresign.objectKey,
    ...(blockMapObjectKey ? { blockMapR2Key: blockMapObjectKey } : {}),
  };
  const registered = await requestJson(buildUrl(base, '/api/admin/companion-artifacts'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(payload),
  });
  console.log('registered desktop_shell artifact');
  console.log(JSON.stringify({
    id: registered.artifact && registered.artifact.id,
    semver: registered.artifact && registered.artifact.semver,
    platform: registered.artifact && registered.artifact.platform,
    channel: registered.artifact && registered.artifact.channel,
    r2Key: registered.artifact && registered.artifact.r2Key,
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
