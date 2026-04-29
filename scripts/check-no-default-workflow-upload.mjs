import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
const ALLOW_MARKER = 'MANUAL_WORKFLOW_UPLOAD_ALLOWED';
const ALLOW_CALLER_NAMES = new Set(['executeManualWorkflowUpload']);

function fail(msg) {
  console.error(`No-default-workflow-upload guard failed: ${msg}`);
  process.exit(1);
}

function listSourceFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      if (entry.name !== '.github') continue;
    }
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      out.push(...listSourceFiles(abs));
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    const ext = dot >= 0 ? entry.name.slice(dot) : '';
    if (!SOURCE_EXTS.has(ext)) continue;
    out.push(abs);
  }
  return out;
}

function main() {
  const files = listSourceFiles(ROOT);
  const offenders = [];
  for (const abs of files) {
    const rel = relative(ROOT, abs).replaceAll('\\', '/');
    if (rel === 'scripts/check-no-default-workflow-upload.mjs') continue;
    const src = readFileSync(abs, 'utf8');
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.includes('pushWorkflowBundleToCloud(')) continue;
      if (line.includes('export async function pushWorkflowBundleToCloud(')) continue;
      const prevLine = i > 0 ? lines[i - 1] ?? '' : '';
      if (line.includes(ALLOW_MARKER) || prevLine.includes(ALLOW_MARKER)) {
        let ownerName = '';
        for (let j = i; j >= 0; j -= 1) {
          const ownerLine = lines[j] || '';
          const m1 = ownerLine.match(/const\s+([A-Za-z0-9_]+)\s*=\s*useCallback\(/);
          if (m1?.[1]) {
            ownerName = m1[1];
            break;
          }
          const m2 = ownerLine.match(/function\s+([A-Za-z0-9_]+)\s*\(/);
          if (m2?.[1]) {
            ownerName = m2[1];
            break;
          }
        }
        if (!ALLOW_CALLER_NAMES.has(ownerName)) {
          offenders.push(`${rel}:${i + 1} (marker used outside allowed function: ${ownerName || 'unknown'})`);
        }
        continue;
      }
      offenders.push(`${rel}:${i + 1}`);
    }
  }

  if (offenders.length > 0) {
    fail(
      `found forbidden workflow upload calls; only marker "${ALLOW_MARKER}" is allowed:\n - ${offenders.join('\n - ')}`
    );
  }

  console.log('No-default-workflow-upload guard passed.');
}

main();

