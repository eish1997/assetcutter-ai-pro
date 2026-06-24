#!/usr/bin/env node
/**
 * Validate all packages under packages/shell-tools/ against ToolSpec + PanelSpec v1.
 * Usage: npx tsx scripts/validate-shell-tools.ts [optional-package-dir]
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateShellToolPackageDir } from '../local-companion/src/shellToolSpec.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const defaultToolsRoot = join(repoRoot, 'packages', 'shell-tools');

function collectPackageRoots(toolsRoot: string): string[] {
  if (!existsSync(toolsRoot)) return [];
  const arg = process.argv[2]?.trim();
  if (arg) {
    return [resolve(process.cwd(), arg)];
  }
  const roots: string[] = [];
  for (const name of readdirSync(toolsRoot, { withFileTypes: true })) {
    if (!name.isDirectory() || name.name.startsWith('.')) continue;
    const pkgRoot = join(toolsRoot, name.name);
    if (existsSync(join(pkgRoot, 'tool.json'))) roots.push(pkgRoot);
  }
  return roots.sort();
}

function main(): void {
  const roots = collectPackageRoots(defaultToolsRoot);
  if (roots.length === 0) {
    console.error('未找到小工具包（packages/shell-tools/*/tool.json）');
    process.exit(1);
  }

  let failed = 0;
  for (const pkgRoot of roots) {
    const name = pkgRoot.split(/[/\\]/).pop() || pkgRoot;
    const result = validateShellToolPackageDir(pkgRoot);
    if (result.ok) {
      console.log(`OK  ${name}  (${result.tool.id}@${result.tool.semver})`);
    } else {
      failed += 1;
      console.error(`FAIL  ${name}  ${result.error}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} 个包校验失败`);
    process.exit(1);
  }
  console.log(`\n全部 ${roots.length} 个包校验通过`);
}

main();
