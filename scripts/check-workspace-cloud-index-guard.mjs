import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TARGET = join(ROOT, 'services/workspaceCloudSync.ts');

const FORBIDDEN_INDEX_TOKENS = [
  'assets',
  'pending',
  'workflow',
  'base64',
  'dataUrl',
  'modelUrls',
  'blob',
  'filePath',
];

function fail(msg) {
  console.error(`Cloud index guard failed: ${msg}`);
  process.exit(1);
}

function main() {
  const src = readFileSync(TARGET, 'utf8');

  const typeMatch = src.match(/export type WorkspaceCloudIndexV1 = \{([\s\S]*?)\n\};/m);
  if (!typeMatch) fail('WorkspaceCloudIndexV1 type not found');
  const typeBody = typeMatch[1];

  const pushMatch = src.match(/const index: WorkspaceCloudIndexV1 = \{([\s\S]*?)\n  \};/m);
  if (!pushMatch) fail('pushWorkspaceIndex index payload not found');
  const pushBody = pushMatch[1];

  for (const token of FORBIDDEN_INDEX_TOKENS) {
    const re = new RegExp(`\\b${token}\\b`, 'i');
    if (re.test(typeBody)) fail(`WorkspaceCloudIndexV1 contains forbidden token "${token}"`);
    if (re.test(pushBody)) fail(`pushWorkspaceIndex payload contains forbidden token "${token}"`);
  }

  if (!/projects:\s*WorkspaceProject\[\]/.test(typeBody)) {
    fail('WorkspaceCloudIndexV1 missing projects: WorkspaceProject[]');
  }
  if (!/projects,\s*$|projects,\n/m.test(pushBody)) {
    fail('pushWorkspaceIndex payload should only carry projects list');
  }

  console.log('Cloud index guard passed.');
}

main();

