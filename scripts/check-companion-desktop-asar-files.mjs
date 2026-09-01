#!/usr/bin/env node
/**
 * Guard: every relative require('./foo.cjs') from companion-desktop main graph
 * must be listed in package.json build.files (or covered by a glob).
 * Prevents packaged app crashing with "Cannot find module".
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, '..', 'companion-desktop');
const pkgPath = join(desktopDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const files = Array.isArray(pkg.build?.files) ? pkg.build.files.map(String) : [];

function globToRegExp(pattern) {
  const n = String(pattern || '').replace(/\\/g, '/');
  // directory/**  or directory/**/*  → anything under that directory
  const starStar = n.match(/^(.*)\/\*\*(\/\*)?$/);
  if (starStar) {
    const base = starStar[1].replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${base}/.+`, 'i');
  }
  const escaped = n
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`, 'i');
}

const matchers = files.map(globToRegExp);

function isListed(relPosix) {
  const n = relPosix.replace(/\\/g, '/');
  return matchers.some((re) => re.test(n));
}

const REQUIRE_RE = /require\(\s*['"](\.\/[^'"]+)['"]\s*\)/g;
const visited = new Set();
const missing = [];
const queue = ['main.cjs'];

while (queue.length) {
  const rel = queue.shift();
  if (!rel || visited.has(rel)) continue;
  visited.add(rel);
  const abs = join(desktopDir, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    missing.push({ rel, reason: 'file_missing_on_disk' });
    continue;
  }
  if (!isListed(rel)) {
    missing.push({ rel, reason: 'not_in_build_files' });
  }
  const src = readFileSync(abs, 'utf8');
  let m;
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(src))) {
    let target = m[1];
    if (!target.startsWith('./') && !target.startsWith('../')) continue;
    // Resolve relative to current file
    const fromDir = dirname(join(desktopDir, rel));
    let resolvedAbs = resolve(fromDir, target);
    if (!resolvedAbs.endsWith('.cjs') && !resolvedAbs.endsWith('.js') && existsSync(resolvedAbs + '.cjs')) {
      resolvedAbs += '.cjs';
    }
    if (!resolvedAbs.startsWith(desktopDir)) continue;
    const nextRel = relative(desktopDir, resolvedAbs).replace(/\\/g, '/');
    if (nextRel.includes('node_modules') || nextRel.startsWith('scripts/')) continue;
    if (!visited.has(nextRel)) queue.push(nextRel);
  }
}

const extraResources = Array.isArray(pkg.build?.extraResources) ? pkg.build.extraResources : [];
const extraFrom = extraResources.map((row) => (typeof row === 'string' ? row : String(row?.from || '')));
const blankRoomSkill = existsSync(join(desktopDir, 'dsh-skills', 'blank-room.md'));
const fingerPlugin = existsSync(join(desktopDir, 'dsh-plugins', 'workspace-finger-plugin.mjs'));
const toolsPlugin = existsSync(join(desktopDir, 'dsh-plugins', 'workspace-tools-plugin.mjs'));
const replayListed = isListed('replay-trace-ring.cjs');
const roomCompartmentListed = isListed('shell-room-compartment.cjs');

await Promise.all([
  // #region agent log
  fetch('http://127.0.0.1:7909/ingest/d8d3abba-20d5-423d-b535-1cdbb700adde',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'61ab0c'},body:JSON.stringify({sessionId:'61ab0c',runId:'asar-gate',hypothesisId:'A',location:'scripts/check-companion-desktop-asar-files.mjs:missing',message:'asar require graph vs build.files',data:{missing,visitedSize:visited.size,replayListed,roomCompartmentListed,hasReplayVisited:visited.has('replay-trace-ring.cjs'),hasRoomVisited:visited.has('shell-room-compartment.cjs')},timestamp:Date.now()})}).catch(()=>{}),
  fetch('http://127.0.0.1:7909/ingest/d8d3abba-20d5-423d-b535-1cdbb700adde',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'61ab0c'},body:JSON.stringify({sessionId:'61ab0c',runId:'asar-gate',hypothesisId:'C',location:'scripts/check-companion-desktop-asar-files.mjs:extra',message:'extraResources for rooms and dsh',data:{extraFrom,blankRoomSkill,fingerPlugin,toolsPlugin,hasDshSkills:extraFrom.includes('dsh-skills'),hasDshPlugins:extraFrom.includes('dsh-plugins'),hasDshBundled:extraFrom.includes('dsh-bundled')},timestamp:Date.now()})}).catch(()=>{}),
  // #endregion
]);

if (missing.length) {
  console.error('[check-companion-desktop-asar-files] FAIL — modules required at runtime but not packaged:');
  for (const row of missing) {
    console.error(`  - ${row.rel} (${row.reason})`);
  }
  console.error('Fix: add them to companion-desktop/package.json → build.files');
  process.exit(1);
}

console.log(
  `[check-companion-desktop-asar-files] ok — ${visited.size} modules reachable from main.cjs, all listed in build.files`,
);
