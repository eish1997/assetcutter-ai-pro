import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const R2_BUNDLE_FILE = join(ROOT, 'services/workspaceR2ImageBundle.ts');
const CLOUD_SYNC_FILE = join(ROOT, 'services/workspaceCloudSync.ts');

function fail(msg) {
  console.error(`Workflow inline-bytes guard failed: ${msg}`);
  process.exit(1);
}

function must(re, src, msg) {
  if (!re.test(src)) fail(msg);
}

function extract(re, src, name) {
  const m = src.match(re);
  if (!m) fail(`${name} not found`);
  return m[1];
}

function main() {
  const r2 = readFileSync(R2_BUNDLE_FILE, 'utf8');
  const cloud = readFileSync(CLOUD_SYNC_FILE, 'utf8');

  const typeBody = extract(/export type WorkflowCloudBundleV2 = \{([\s\S]*?)\n\};/m, r2, 'WorkflowCloudBundleV2 type');
  const packFn = extract(
    /export async function packWorkflowBundleForCloud\([\s\S]*?\): Promise<WorkflowCloudBundleV2> \{([\s\S]*?)\n\}/m,
    r2,
    'packWorkflowBundleForCloud function body'
  );
  const packReturn = extract(/return \{([\s\S]*?)\n  \};/m, packFn, 'packWorkflowBundleForCloud return');

  // 1) 打包对象只承载瘦身后的索引字段，不应出现显式大字节字段名。
  const forbidden = ['base64', 'dataUrl', 'blob', 'filePath', 'inlineData'];
  for (const token of forbidden) {
    const re = new RegExp(`\\b${token}\\b`, 'i');
    if (re.test(typeBody)) fail(`WorkflowCloudBundleV2 type contains forbidden token "${token}"`);
    if (re.test(packReturn)) fail(`pack return contains forbidden token "${token}"`);
  }

  // 2) 必须把可内联字段清空为 objectKey 引用路径。
  must(/a\.original\s*=\s*'';/, r2, 'asset original is not cleared after objectKey upload');
  must(/t\.inputImage\s*=\s*'';/, r2, 'pending inputImage is not cleared after objectKey upload');
  must(/a\.results\s*=\s*nextResults;/, r2, 'asset results replacement missing');

  // 3) 云端写入 workflow.json 必须写 packed（不是原 bundle）。
  must(/const packed = await packWorkflowBundleForCloud\(/, cloud, 'packWorkflowBundleForCloud is not used');
  must(/JSON\.stringify\(packed\)/, cloud, 'cloud workflow upload does not stringify packed bundle');

  console.log('Workflow inline-bytes guard passed.');
}

main();

