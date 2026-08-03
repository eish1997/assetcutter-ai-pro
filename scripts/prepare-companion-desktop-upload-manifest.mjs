#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const COMPANION_DISTRIBUTION_PREFIX = 'public/companion-distribution/';

function readArg(name, fallback = '') {
  const prefix = `${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function readDesktopVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.resolve('companion-desktop/package.json'), 'utf8'));
  return String(pkg.version || '').trim();
}

function hashFile(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function safeName(name) {
  return String(name || 'artifact.bin').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'artifact.bin';
}

function findInstaller(version) {
  const outDir = path.resolve('companion-desktop', `dist-out-${version.replace(/\./g, '')}`, 'installer');
  if (!fs.existsSync(outDir)) throw new Error(`Installer dir not found: ${outDir}`);
  const candidates = fs.readdirSync(outDir)
    .filter((name) => name.startsWith(`AssetCutterCompanion-${version}-`) && name.endsWith('-x64.exe'))
    .map((name) => {
      const file = path.join(outDir, name);
      return { name, file, mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  if (!candidates.length) throw new Error(`Installer exe not found in ${outDir}`);
  const exePath = candidates[0].file;
  const blockMapPath = `${exePath}.blockmap`;
  return { outDir, exePath, blockMapPath: fs.existsSync(blockMapPath) ? blockMapPath : '' };
}

function main() {
  const version = readArg('--version', readDesktopVersion());
  const channel = readArg('--channel', 'stable');
  const platform = readArg('--platform', 'win32');
  const label = readArg('--label', `AssetCutter Companion ${version}`);
  const notes = readArg('--notes', 'Copilot/Codex one-click setup fix: install missing Codex CLI, sync cloud identity, and continue conversation.');
  const timestamp = readArg('--timestamp', String(Date.now()));
  const outPath = path.resolve(readArg('--out', path.join('companion-desktop', `dist-out-${version.replace(/\./g, '')}`, 'installer', 'desktop-upload-manifest.json')));
  const { exePath, blockMapPath } = findInstaller(version);
  const exeStat = fs.statSync(exePath);
  const exeName = path.basename(exePath);
  const objectKey = `${COMPANION_DISTRIBUTION_PREFIX}${timestamp}_${safeName(exeName)}`;
  const manifest = {
    kind: 'desktop_shell',
    semver: version,
    channel,
    platform,
    label,
    notes,
    fileName: exeName,
    filePath: exePath,
    r2Key: objectKey,
    contentType: 'application/octet-stream',
    bytes: exeStat.size,
    sha256: hashFile(exePath, 'sha256'),
    sha512: hashFile(exePath, 'sha512'),
  };
  if (blockMapPath) {
    const bmStat = fs.statSync(blockMapPath);
    manifest.blockMapFileName = path.basename(blockMapPath);
    manifest.blockMapFilePath = blockMapPath;
    manifest.blockMapR2Key = `${objectKey}.blockmap`;
    manifest.blockMapBytes = bmStat.size;
    manifest.blockMapContentType = 'application/octet-stream';
    manifest.blockMapSha256 = hashFile(blockMapPath, 'sha256');
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('Companion desktop upload manifest prepared');
  console.log(`version: ${version}`);
  console.log(`installer: ${exePath}`);
  console.log(`manifest: ${outPath}`);
  console.log(`r2Key: ${manifest.r2Key}`);
  if (manifest.blockMapR2Key) console.log(`blockMapR2Key: ${manifest.blockMapR2Key}`);
  console.log('');
  console.log('Admin registration payload:');
  console.log(JSON.stringify({
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
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
