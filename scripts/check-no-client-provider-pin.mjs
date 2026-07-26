#!/usr/bin/env node
/**
 * Prevent client createAiJob paths from hard-pinning multi-provider families.
 * Default platform jobs must omit `provider` so Gateway can pick any keyed route
 * (e.g. Gemini → 302ai when Vertex Key is missing).
 *
 * Single-provider SKU facades (Jimeng / Tripo) may still pin — listed in ALLOWED.
 */
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const SCAN_DIRS = ['services', 'components', 'hooks'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** Multi-route providers: never hardcode as createAiJob.provider in client facades. */
const FORBIDDEN_PROVIDERS = new Set([
  'vertex-site',
  'gemini-aistudio',
  'openai-official',
  '302ai',
  'aihubmix',
  'toapis',
  'tinysnow',
  'vectorengine',
]);

/**
 * file → allowed provider ids for literal `provider: '…'` near createAiJob.
 * Empty set = no literal multi-route pin allowed in that file.
 */
const ALLOWED_PIN_BY_FILE = new Map([
  // Single-provider SKU facades (not multi-route families).
  ['services/aiGatewayJimengExecution.ts', new Set(['volcengine-jimeng'])],
  ['services/generate3d/tripoWorkflow.ts', new Set(['tripo'])],
]);

/** unifiedAiGateway must not re-delegate arena/translate to geminiService Raw (Vertex sync bypass). */
const FORBIDDEN_RAW_IMPORTS = [
  'generateArenaABPrompts as generateArenaABPromptsRaw',
  'generateArenaPrompts as generateArenaPromptsRaw',
  'optimizeLoserPrompt as optimizeLoserPromptRaw',
  'generateNewChallenger as generateNewChallengerRaw',
  'translateToChinese as translateToChineseRaw',
];

const PROVIDER_LITERAL_RE =
  /\bprovider\s*:\s*['"]([a-z0-9-]+)['"]/g;

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

function fileMentionsCreateAiJob(source) {
  return /\bcreateAiJob\b/.test(source);
}

const violations = [];
const gatewayFacade = path.join(repoRoot, 'services', 'unifiedAiGateway.ts');
if (fs.existsSync(gatewayFacade)) {
  const facadeSrc = fs.readFileSync(gatewayFacade, 'utf8');
  for (const needle of FORBIDDEN_RAW_IMPORTS) {
    if (facadeSrc.includes(needle)) {
      violations.push({ file: 'services/unifiedAiGateway.ts', providerId: `raw-import:${needle}` });
    }
  }
}

for (const dir of SCAN_DIRS) {
  for (const file of walk(path.join(repoRoot, dir))) {
    const rel = toPosix(path.relative(repoRoot, file));
    const source = fs.readFileSync(file, 'utf8');
    if (!fileMentionsCreateAiJob(source)) continue;

    const allowed = ALLOWED_PIN_BY_FILE.get(rel) || new Set();
    PROVIDER_LITERAL_RE.lastIndex = 0;
    let match;
    while ((match = PROVIDER_LITERAL_RE.exec(source))) {
      const providerId = match[1];
      if (!FORBIDDEN_PROVIDERS.has(providerId)) continue;
      if (allowed.has(providerId)) continue;
      violations.push({ file: rel, providerId, index: match.index });
    }
  }
}

if (violations.length > 0) {
  console.error('Client provider-pin guard failed (multi-route providers must not be hardcoded on createAiJob):');
  for (const v of violations) {
    console.error(`- ${v.file}: provider: '${v.providerId}'`);
  }
  console.error('');
  console.error('Default platform path: omit provider and let Gateway route decision pick a keyed provider.');
  console.error('Only pin when explicitByok / admin_pin / single-provider SKU facade (see ALLOWED_PIN_BY_FILE).');
  process.exit(1);
}

console.log('Client provider-pin guard passed.');
