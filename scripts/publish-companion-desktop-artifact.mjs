#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

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

function cleanMachineAcceptanceNotes(manifest, overrides = {}) {
  const acceptance = manifest.cleanMachineAcceptance || null;
  const script = manifest.cleanMachineAcceptanceScript || null;
  const bundle = manifest.cleanMachineAcceptanceBundle || null;
  if (!acceptance && !script && !bundle && !overrides.cleanMachineAcceptanceScriptR2Key && !overrides.cleanMachineAcceptanceBundleR2Key) return '';
  const lines = ['#cleanMachineAcceptance:required'];
  const scriptKey = String(overrides.cleanMachineAcceptanceScriptR2Key || script?.r2Key || '').trim();
  if (scriptKey) lines.push(`#cleanMachineAcceptanceScriptR2Key:${scriptKey}`);
  const bundleKey = String(overrides.cleanMachineAcceptanceBundleR2Key || bundle?.r2Key || '').trim();
  if (bundleKey) lines.push(`#cleanMachineAcceptanceBundleR2Key:${bundleKey}`);
  if (acceptance && Array.isArray(acceptance.bundleFiles) && acceptance.bundleFiles.length) {
    lines.push(`#cleanMachineAcceptanceBundleFiles:${acceptance.bundleFiles.map(String).join(',')}`);
  }
  if (acceptance && acceptance.localCommand) {
    lines.push(`#cleanMachineAcceptanceLocalCommand:${String(acceptance.localCommand)}`);
  }
  if (acceptance && acceptance.postInstallCommand) {
    lines.push(`#cleanMachineAcceptancePostInstallCommand:${String(acceptance.postInstallCommand)}`);
  }
  if (acceptance && acceptance.reportGlob) {
    lines.push(`#cleanMachineAcceptanceReportGlob:${String(acceptance.reportGlob)}`);
  }
  return lines.join('\n');
}

function appendNotes(baseNotes, extraNotes) {
  const base = String(baseNotes || '').trim();
  const extra = String(extraNotes || '').trim();
  if (!base) return extra;
  if (!extra) return base;
  return `${base}\n${extra}`;
}

function registrationPayload(manifest, overrides = {}) {
  const notes = appendNotes(
    manifest.notes,
    cleanMachineAcceptanceNotes(manifest, {
      cleanMachineAcceptanceScriptR2Key: overrides.cleanMachineAcceptanceScriptR2Key,
      cleanMachineAcceptanceBundleR2Key: overrides.cleanMachineAcceptanceBundleR2Key,
    }),
  );
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
    notes,
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
    if (manifest.cleanMachineAcceptanceScript || manifest.cleanMachineAcceptanceBundle) {
      console.log('Dry-run extra upload:');
      console.log(JSON.stringify({
        cleanMachineAcceptanceScript: manifest.cleanMachineAcceptanceScript,
        cleanMachineAcceptanceBundle: manifest.cleanMachineAcceptanceBundle,
      }, null, 2));
    }
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

  let acceptanceScriptObjectKey = '';
  const acceptanceScript = manifest.cleanMachineAcceptanceScript || null;
  if (acceptanceScript && acceptanceScript.filePath) {
    const acceptancePath = requireFile(acceptanceScript.filePath, 'clean-machine acceptance script');
    const acceptancePresign = await presign(
      base,
      cookie,
      acceptanceScript.fileName || path.basename(acceptancePath),
      acceptanceScript.contentType || 'text/plain; charset=utf-8',
      acceptanceScript.r2Key || `${exePresign.objectKey}.verify-codex-clean-machine.ps1`,
    );
    acceptanceScriptObjectKey = acceptancePresign.objectKey;
    console.log(`upload clean-machine acceptance script -> ${acceptancePresign.objectKey}`);
    await uploadFile(acceptancePresign.uploadUrl, acceptancePath, acceptancePresign.contentType, false);
  }
  let acceptanceBundleObjectKey = '';
  const acceptanceBundle = manifest.cleanMachineAcceptanceBundle || null;
  if (acceptanceBundle && acceptanceBundle.filePath) {
    const acceptanceBundlePath = requireFile(acceptanceBundle.filePath, 'clean-machine acceptance bundle');
    const acceptanceBundlePresign = await presign(
      base,
      cookie,
      acceptanceBundle.fileName || path.basename(acceptanceBundlePath),
      acceptanceBundle.contentType || 'application/zip',
      acceptanceBundle.r2Key || `${exePresign.objectKey}.clean-machine-acceptance.zip`,
    );
    acceptanceBundleObjectKey = acceptanceBundlePresign.objectKey;
    console.log(`upload clean-machine acceptance bundle -> ${acceptanceBundlePresign.objectKey}`);
    await uploadFile(acceptanceBundlePresign.uploadUrl, acceptanceBundlePath, acceptanceBundlePresign.contentType, false);
  }

  const payload = {
    ...registrationPayload(manifest, {
      cleanMachineAcceptanceScriptR2Key: acceptanceScriptObjectKey,
      cleanMachineAcceptanceBundleR2Key: acceptanceBundleObjectKey,
    }),
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
    cleanMachineAcceptanceScriptR2Key: acceptanceScriptObjectKey || undefined,
    cleanMachineAcceptanceBundleR2Key: acceptanceBundleObjectKey || undefined,
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
