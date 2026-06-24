#!/usr/bin/env node
/**
 * Pack packages/shell-tools/<name>/ into a ZIP for shell_tool_bundle distribution.
 * Usage: npx tsx scripts/pack-shell-tool.mjs [toolDirName]
 */
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { validateShellToolPackageDir } from '../local-companion/src/shellToolSpec.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const toolsRoot = join(repoRoot, 'packages', 'shell-tools');

function collectFiles(dir, base = dir) {
  /** @type {{ path: string, data: Uint8Array }[]} */
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    const rel = relative(base, full).replace(/\\/g, '/');
    if (ent.isDirectory()) out.push(...collectFiles(full, base));
    else out.push({ path: rel, data: new Uint8Array(readFileSync(full)) });
  }
  return out;
}

async function packOne(name) {
  const src = join(toolsRoot, name);
  if (!existsSync(join(src, 'tool.json'))) {
    throw new Error(`未找到 ${src}/tool.json`);
  }
  const v = validateShellToolPackageDir(src);
  if (!v.ok) throw new Error(`校验失败: ${v.error}`);

  const outDir = join(repoRoot, 'dist', 'shell-tools');
  await mkdir(outDir, { recursive: true });
  const outZip = join(outDir, `${v.tool.id}-${v.tool.semver}.zip`);
  await rm(outZip, { force: true });

  const files = collectFiles(src);
  /** @type {Record<string, Uint8Array>} */
  const zipInput = {};
  for (const f of files) zipInput[f.path] = f.data;
  const zipped = zipSync(zipInput, { level: 9 });
  await new Promise((resolveP, rejectP) => {
    const ws = createWriteStream(outZip);
    ws.on('finish', resolveP);
    ws.on('error', rejectP);
    ws.end(Buffer.from(zipped));
  });

  console.log(`OK  ${outZip}  (${zipped.length} bytes)`);
}

async function main() {
  const arg = process.argv[2]?.trim();
  const names = arg
    ? [arg]
    : readdirSync(toolsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
  if (names.length === 0) {
    console.error('用法: npx tsx scripts/pack-shell-tool.mjs [toolDirName]');
    process.exit(1);
  }
  for (const n of names) await packOne(n);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
