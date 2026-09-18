/**
 * Snapshot basketikun/infinite-canvas (MIT) canvas layer into vendor/.
 * Pinned SHA only — do not follow main.
 */
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const SHA = 'e856c878e0a34651bb828e28f0af20d71016a7d4';
const ZIP_URL = `https://github.com/basketikun/infinite-canvas/archive/${SHA}.zip`;
const REPO_URL = 'https://github.com/basketikun/infinite-canvas';
const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const DEST = join(ROOT, 'vendor', 'basketikun-infinite-canvas');

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.md',
  '.txt',
  '.svg',
]);

function shouldCopy(relFromSrc) {
  const n = relFromSrc.replaceAll('\\', '/');
  if (n === 'LICENSE' || n === 'LICENSE.md') return { dest: 'LICENSE' };
  if (!n.startsWith('web/src/')) return null;
  const rest = n.slice('web/src/'.length);
  if (rest.startsWith('components/canvas/')) return { dest: rest };
  if (rest.startsWith('components/ui/')) return { dest: rest };
  if (rest.startsWith('lib/canvas/')) return { dest: rest };
  if (rest.startsWith('stores/canvas/')) return { dest: rest };
  if (rest.startsWith('types/')) return { dest: rest };
  if (rest.startsWith('constant/')) return { dest: rest };
  if (rest.startsWith('stores/') && !rest.includes('agent')) return { dest: rest };
  const exact = new Set([
    'pages/canvas/project.tsx',
    'lib/canvas-theme.ts',
    'lib/image-utils.ts',
    'lib/image-thumbnail.ts',
    'lib/image-reference-prompt.ts',
    'lib/utils.ts',
    'lib/keyboard-event.ts',
    'lib/zip.ts',
    'lib/audio-generation.ts',
    'lib/media-size.ts',
    'hooks/use-copy-text.ts',
    'i18n/locales/zh-CN.ts',
    'i18n/locales/en-US.ts',
    'i18n/index.ts',
    'components/ui/animated-theme-toggler.tsx',
    'components/audio-settings-panel.tsx',
    'components/image-settings-panel.tsx',
    'components/text-settings-panel.tsx',
    'components/video-settings-panel.tsx',
    'components/model-picker.tsx',
    'components/prompts/prompt-select-dialog.tsx',
    'components/ui/select.tsx',
  ]);
  if (exact.has(rest)) return { dest: rest };
  return null;
}

function rewriteIcImports(text) {
  return text
    .replaceAll('from "@/', 'from "@ic/')
    .replaceAll("from '@/", "from '@ic/")
    .replaceAll('import("@/', 'import("@ic/')
    .replaceAll("import('@/", "import('@ic/");
}

function isTextPath(name) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return lower === 'license' || lower === 'notice';
  return TEXT_EXT.has(lower.slice(dot));
}

async function downloadZip() {
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    'http://127.0.0.1:7890';
  let lastErr;
  for (const useProxy of [false, true]) {
    try {
      const init = { redirect: 'follow' };
      if (useProxy) {
        const { ProxyAgent, fetch: undiciFetch } = await import('undici');
        init.dispatcher = new ProxyAgent(proxy);
        const res = await undiciFetch(ZIP_URL, init);
        if (!res.ok) throw new Error(`zip HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      }
      const res = await fetch(ZIP_URL, { redirect: 'follow' });
      if (!res.ok) throw new Error(`zip HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function stripZipPrefix(entryName) {
  const n = entryName.replaceAll('\\', '/');
  const slash = n.indexOf('/');
  return slash >= 0 ? n.slice(slash + 1) : n;
}

const zipBuf = await downloadZip();
const files = unzipSync(new Uint8Array(zipBuf));

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

let copied = 0;
for (const [entryName, bytes] of Object.entries(files)) {
  if (!bytes || !bytes.length) continue;
  if (entryName.endsWith('/')) continue;
  const rel = stripZipPrefix(entryName);
  const mapped = shouldCopy(rel);
  if (!mapped) continue;
  const destPath = join(DEST, mapped.dest);
  mkdirSync(dirname(destPath), { recursive: true });
  if (isTextPath(mapped.dest) || isTextPath(rel)) {
    let text = new TextDecoder('utf-8').decode(bytes);
    if (mapped.dest !== 'LICENSE') text = rewriteIcImports(text);
    writeFileSync(destPath, text, 'utf8');
  } else {
    writeFileSync(destPath, Buffer.from(bytes));
  }
  copied += 1;
}

if (copied < 20) {
  throw new Error(`vendor copy too small: ${copied} files`);
}

writeFileSync(
  join(DEST, 'SOURCE.txt'),
  [
    `repo: ${REPO_URL}`,
    `commit: ${SHA}`,
    `tag: v0.19.0`,
    `zip: ${ZIP_URL}`,
    `vendoredAt: ${new Date().toISOString()}`,
    '',
  ].join('\n'),
  'utf8',
);

writeFileSync(
  join(DEST, 'NOTICE'),
  [
    'This directory is a snapshot of MIT-licensed source from',
    `${REPO_URL} @ ${SHA}.`,
    '',
    'Used only as a canvas view (看法) in AssetCutter workshop front-hall.',
    'Not L0 goods. Disk files remain the source of truth.',
    'Do not treat IndexedDB / exported JSON from this snapshot as inventory.',
    '',
  ].join('\n'),
  'utf8',
);

console.log(`[vendor-infinite-canvas] copied ${copied} files → ${posix.normalize(DEST.replaceAll('\\', '/'))}`);

const i18nPath = join(DEST, 'i18n', 'index.ts');
if (existsSync(i18nPath)) {
  let i18nText = readFileSync(i18nPath, 'utf8');
  i18nText = i18nText.replace(
    'import i18n from "i18next";',
    'import { createInstance } from "i18next";',
  );
  i18nText = i18nText.replace(
    'const LOCALE_STORAGE_KEY = "infinite-canvas:locale";\n\ni18n.use(initReactI18next).init({',
    'const LOCALE_STORAGE_KEY = "infinite-canvas:locale";\nconst i18n = createInstance();\n\ni18n.use(initReactI18next).init({',
  );
  i18nText = i18nText.replace(
    'lng: (localStorage.getItem(LOCALE_STORAGE_KEY) as AppLocale) || "zh-CN",',
    'lng: (typeof localStorage !== "undefined" && (localStorage.getItem(LOCALE_STORAGE_KEY) as AppLocale)) || "zh-CN",',
  );
  i18nText = i18nText.replace(
    'localStorage.setItem(LOCALE_STORAGE_KEY, locale);',
    'if (typeof localStorage !== "undefined") localStorage.setItem(LOCALE_STORAGE_KEY, locale);',
  );
  writeFileSync(i18nPath, i18nText, 'utf8');
}

const infiniteCanvasPath = join(DEST, 'components', 'canvas', 'infinite-canvas.tsx');
if (existsSync(infiniteCanvasPath)) {
  let text = readFileSync(infiniteCanvasPath, 'utf8');
  text = text.replace(
    'const shouldPan = event.button === 1 || (event.button === 0 && activeTool === "pan" && isBackgroundClick);',
    'const shouldPan = event.button === 1 || (event.button === 0 && isBackgroundClick && (activeTool === "pan" || activeTool === "select"));',
  );
  text = text.replaceAll(
    'event.currentTarget.setPointerCapture(event.pointerId);',
    'event.currentTarget.setPointerCapture?.(event.pointerId);',
  );
  writeFileSync(infiniteCanvasPath, text, 'utf8');
}

const toolbarPath = join(DEST, 'components', 'canvas', 'canvas-toolbar.tsx');
if (existsSync(toolbarPath)) {
  let text = readFileSync(toolbarPath, 'utf8');
  text = text.replace('style={{ left: 300, right: 16 }}', 'style={{ left: 16, right: 16 }}');
  writeFileSync(toolbarPath, text, 'utf8');
}

const { spawnSync } = await import('node:child_process');
const shim = spawnSync(process.execPath, [join(ROOT, 'scripts/_write-ic-shims.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (shim.status) process.exit(shim.status);
