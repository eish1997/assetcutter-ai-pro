#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const SCAN_DIRS = ['components', 'hooks', 'services'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const SUPPLIER_MODULES = [
  'services/geminiService',
  'services/tripoService',
  'services/tencentService',
  'services/jimeng/adapter',
  'services/jimeng/client',
];

const ALLOWED_FILES = new Set([
  // Facade / implementation layer.
  'services/unifiedAiGateway.ts',
  'services/geminiService.ts',
  'services/tripoService.ts',
  'services/tencentService.ts',
  'services/jimeng/adapter.ts',
  'services/jimeng/client.ts',
  'services/jimeng/pickJimengBinding.ts',

  // Explicit 3D warehouse exceptions.
  'services/generate3d/tripoWorkflow.ts',
  'services/generate3d/tencentWorkflow.ts',
  'services/generate3d/tencentQueueRunner.ts',
  'services/generate3d/preflightGenerate3d.ts',

  // Legacy persistence / rehydrate utilities. Keep listed until model3d.generate is fully Gateway-shaped.
  'hooks/useGenerate3DManager.ts',
  'services/downloadModelFile.ts',
  'services/persistWorkflow3dSlots.ts',
  'services/tripoModelPersist.ts',
  'services/tencentModelPersist.ts',
  'services/workflowGeminiAsyncRecovery.ts',
  'services/workflowTencentModelRehydrate.ts',
  'services/workflowTripoModelRehydrate.ts',

  // UI currently reads a Tripo sentinel constant only; migrate when 3D route schema is unified.
  'components/asset-set/AssetSetPanel.tsx',
]);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
      walk(full, out);
      continue;
    }
    if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return specifier.replace(/\\/g, '/');
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return toPosix(path.relative(repoRoot, candidate)).replace(/\.(tsx?|jsx?)$/, '');
    }
  }
  return toPosix(path.relative(repoRoot, base)).replace(/\.(tsx?|jsx?)$/, '');
}

function findImports(source) {
  const imports = [];
  const importFrom = /\bimport\s+(?:type\s+)?[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g;
  const sideEffect = /\bimport\s+['"]([^'"]+)['"]/g;
  for (const re of [importFrom, sideEffect]) {
    let match;
    while ((match = re.exec(source))) imports.push(match[1]);
  }
  return imports;
}

const violations = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(path.join(repoRoot, dir))) {
    const rel = toPosix(path.relative(repoRoot, file));
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of findImports(source)) {
      const resolved = resolveImport(file, specifier);
      const supplier = SUPPLIER_MODULES.find((mod) => resolved === mod || resolved.startsWith(`${mod}/`));
      if (!supplier) continue;
      if (ALLOWED_FILES.has(rel)) continue;
      violations.push({ file: rel, import: specifier, resolved: supplier });
    }
  }
}

if (violations.length > 0) {
  console.error('AI routing boundary violations found:');
  for (const v of violations) {
    console.error(`- ${v.file} imports ${v.import} (${v.resolved})`);
  }
  console.error('');
  console.error('Business UI and workflow code should go through the unified generation/Gateway layer.');
  console.error('If this is a temporary legacy exception, document it in docs/AI执行路由闭环架构审计.md and add it to ALLOWED_FILES with an owner.');
  process.exit(1);
}

console.log('AI routing boundary guard passed.');
