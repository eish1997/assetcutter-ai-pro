import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const SCAN_TARGETS = [
  'App.tsx',
  'components',
  'services',
  'server',
  'scripts',
  'vite.config.ts',
  'local-companion/src',
  'local-companion/public/index.html',
];

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.html']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'Lib', '.data']);

const LOCALHOST_RE = /\b(?:localhost|127\.0\.0\.1)\b/i;
const ABS_PATH_RE = /\b(?:[A-Za-z]:\\\\|\/(?:Users|home|var|tmp)\/)/;

// 这些文件含本机地址是“运行期配置/网络探测”所需，允许保留。
const ALLOW_LOCALHOST_PATHS = new Set([
  'scripts/check-persistence-guard.mjs',
  'components/SettingsSection.tsx',
  'components/WorkflowApiKeyModal.tsx',
  'services/capabilityPreviewUrl.ts',
  'services/companionLocalPrefs.ts',
  'services/geminiService.ts',
  'services/settingsStore.ts',
  'services/userUiPrefs.ts',
  'server/ai3d-proxy.js',
  'server/auth-api.js',
  'server/bridge-relay.js',
  'server/gemini-proxy-api.js',
  'server/r2-storage-handlers.js',
  'scripts/bridge-relay-smoke.mjs',
  'scripts/start-seam-backend.js',
  'vite.config.ts',
  'local-companion/public/index.html',
  'local-companion/src/accessGate.ts',
  'local-companion/src/compute/seamRepairAdapter.ts',
  'local-companion/src/httpHandler.ts',
  'local-companion/src/httpServer.ts',
  'local-companion/src/hostPluginBundles.ts',
  'local-companion/src/main.ts',
]);

function walk(absPath, out) {
  const st = statSync(absPath);
  if (st.isDirectory()) {
    const name = absPath.split(/[\\/]/).pop() || '';
    if (IGNORE_DIRS.has(name)) return;
    for (const e of readdirSync(absPath)) {
      walk(join(absPath, e), out);
    }
    return;
  }
  const rel = relative(ROOT, absPath).replace(/\\/g, '/');
  const dot = rel.lastIndexOf('.');
  const ext = dot >= 0 ? rel.slice(dot) : '';
  if (!SOURCE_EXT.has(ext)) return;
  out.push(rel);
}

function collectFiles() {
  const files = [];
  for (const t of SCAN_TARGETS) {
    const abs = join(ROOT, t);
    try {
      walk(abs, files);
    } catch {
      // ignore missing optional targets
    }
  }
  return files;
}

function main() {
  const files = collectFiles();
  const violations = [];

  for (const rel of files) {
    const content = readFileSync(join(ROOT, rel), 'utf8');
    if (LOCALHOST_RE.test(content) && !ALLOW_LOCALHOST_PATHS.has(rel)) {
      violations.push(`[localhost] ${rel}`);
    }
    if (ABS_PATH_RE.test(content) && !ALLOW_LOCALHOST_PATHS.has(rel)) {
      violations.push(`[abs-path] ${rel}`);
    }
  }

  if (violations.length > 0) {
    console.error('持久化守卫失败：检测到新增本机地址/绝对路径风险，请改为相对 key 或加入明确白名单。');
    for (const v of violations) console.error(` - ${v}`);
    process.exit(1);
  }

  console.log(`Persistence guard passed (${files.length} files checked).`);
}

main();

