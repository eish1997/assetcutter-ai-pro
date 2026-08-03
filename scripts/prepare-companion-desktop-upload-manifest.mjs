#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const COMPANION_DISTRIBUTION_PREFIX = 'public/companion-distribution/';
const allowStaleInstaller = process.argv.includes('--allow-stale-installer');
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

function walkFiles(root, options = {}) {
  if (!fs.existsSync(root)) return [];
  const skipDirs = new Set(options.skipDirs || []);
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      out.push(...walkFiles(full, options));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function desktopSourceFilesForFreshness() {
  const root = path.resolve('companion-desktop');
  const files = [
    'main.cjs',
    'preload-shell.cjs',
    'preload-tool-window.cjs',
    'preload-workbench.cjs',
    'package.json',
    'agent-store.cjs',
    'codex-auth-sync.cjs',
    'codex-mcp-config.cjs',
  ].map((name) => path.join(root, name));
  files.push(...walkFiles(path.join(root, 'brain-adapters')));
  files.push(...walkFiles(path.join(root, 'shell')));
  return files.filter((file) => fs.existsSync(file));
}

function newestMtime(files) {
  let newest = { file: '', mtimeMs: 0 };
  for (const file of files) {
    const stat = fs.statSync(file);
    if (stat.mtimeMs > newest.mtimeMs) newest = { file, mtimeMs: stat.mtimeMs };
  }
  return newest;
}

function assertInstallerFresh(exePath) {
  const exeStat = fs.statSync(exePath);
  const newest = newestMtime(desktopSourceFilesForFreshness());
  if (!newest.file || newest.mtimeMs <= exeStat.mtimeMs + 1000) {
    return { ok: true, newestSource: newest, installerMtimeMs: exeStat.mtimeMs };
  }
  const detail =
    `Installer is older than desktop source. Repack before publishing.\n` +
    `installer: ${exePath} (${new Date(exeStat.mtimeMs).toISOString()})\n` +
    `newest source: ${newest.file} (${new Date(newest.mtimeMs).toISOString()})`;
  if (!allowStaleInstaller) throw new Error(`${detail}\nPass --allow-stale-installer only for diagnostics.`);
  console.warn(`[WARN] ${detail}`);
  return { ok: false, newestSource: newest, installerMtimeMs: exeStat.mtimeMs };
}

function assertBuiltAsarCodexOnly(outDir) {
  const asarPath = path.join(outDir, 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) {
    return { ok: true, checked: false, detail: `app.asar not found at ${asarPath}; skipped content scan` };
  }
  const asar = require('../companion-desktop/node_modules/@electron/asar');
  const files = asar.listPackage(asarPath).map((entry) => String(entry || '').replace(/\\/g, '/').replace(/^\/+/, ''));
  const forbidden = files.filter((file) => FORBIDDEN_EXTERNAL_AGENT_PATTERNS.some((pattern) => pattern.test(file)));
  if (forbidden.length) {
    throw new Error(`Built app.asar still contains non-Codex agent files: ${forbidden.join(', ')}`);
  }
  return { ok: true, checked: true, detail: 'built app.asar contains Codex-only agent files' };
}

function main() {
  const version = readArg('--version', readDesktopVersion());
  const channel = readArg('--channel', 'stable');
  const platform = readArg('--platform', 'win32');
  const label = readArg('--label', `AssetCutter Companion ${version}`);
  const notes = readArg('--notes', 'Copilot/Codex one-click setup fix: install missing Codex CLI, sync cloud identity, and continue conversation.');
  const timestamp = readArg('--timestamp', String(Date.now()));
  const outPath = path.resolve(readArg('--out', path.join('companion-desktop', `dist-out-${version.replace(/\./g, '')}`, 'installer', 'desktop-upload-manifest.json')));
  const { outDir, exePath, blockMapPath } = findInstaller(version);
  const freshness = assertInstallerFresh(exePath);
  const asarCodexOnly = assertBuiltAsarCodexOnly(outDir);
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
    freshness,
    asarCodexOnly,
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
  const acceptanceScriptPath = path.join(outDir, 'verify-codex-clean-machine.ps1');
  if (fs.existsSync(acceptanceScriptPath)) {
    const acceptanceStat = fs.statSync(acceptanceScriptPath);
    const acceptanceReadmePath = path.join(outDir, 'README-clean-machine.txt');
    const acceptanceBundleFiles = [exeName, path.basename(acceptanceScriptPath)];
    if (fs.existsSync(acceptanceReadmePath)) acceptanceBundleFiles.push(path.basename(acceptanceReadmePath));
    manifest.cleanMachineAcceptanceScript = {
      fileName: path.basename(acceptanceScriptPath),
      filePath: acceptanceScriptPath,
      r2Key: `${objectKey}.verify-codex-clean-machine.ps1`,
      contentType: 'text/plain; charset=utf-8',
      bytes: acceptanceStat.size,
      sha256: hashFile(acceptanceScriptPath, 'sha256'),
    };
    manifest.cleanMachineAcceptance = {
      bundleFiles: acceptanceBundleFiles,
      localCommand:
        `powershell -ExecutionPolicy Bypass -File .\\${path.basename(acceptanceScriptPath)} ` +
        `-LaunchInstaller -AutoCodexSetup -Strict -DesktopVersion ${version} ` +
        `-Cookie <logged-in-cookie>`,
      postInstallCommand:
        `powershell -ExecutionPolicy Bypass -File .\\${path.basename(acceptanceScriptPath)} ` +
        `-AutoCodexSetup -Strict -DesktopVersion ${version} ` +
        `-Cookie <logged-in-cookie>`,
      reportGlob: 'codex-clean-machine-report-*.json',
    };
  }
  const acceptanceZipPath = path.join(outDir, `AssetCutterCompanion-${version}-clean-machine-acceptance.zip`);
  if (fs.existsSync(acceptanceZipPath)) {
    const acceptanceZipStat = fs.statSync(acceptanceZipPath);
    manifest.cleanMachineAcceptanceBundle = {
      fileName: path.basename(acceptanceZipPath),
      filePath: acceptanceZipPath,
      r2Key: `${objectKey}.clean-machine-acceptance.zip`,
      contentType: 'application/zip',
      bytes: acceptanceZipStat.size,
      sha256: hashFile(acceptanceZipPath, 'sha256'),
    };
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
    freshness: manifest.freshness,
    asarCodexOnly: manifest.asarCodexOnly,
    blockMapBytes: manifest.blockMapBytes,
    blockMapR2Key: manifest.blockMapR2Key,
    cleanMachineAcceptanceScript: manifest.cleanMachineAcceptanceScript,
    cleanMachineAcceptance: manifest.cleanMachineAcceptance,
    cleanMachineAcceptanceBundle: manifest.cleanMachineAcceptanceBundle,
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
