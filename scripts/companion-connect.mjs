#!/usr/bin/env node
/**
 * Phase B：一条命令连接已有 Hermes / ScriptHub
 *
 * 用法：
 *   node scripts/companion-connect.mjs hermes --detect [--write-mcp] [--url URL] [--api-key KEY]
 *   node scripts/companion-connect.mjs scripthub [--detect] [--url URL]
 *   node scripts/companion-connect.mjs all --detect --write-mcp
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createAgentStore } = require('../companion-desktop/agent-store.cjs');
const companionConnect = require('../companion-desktop/companion-connect.cjs');

function parseArgs(argv) {
  const args = argv.slice(2);
  const cmd = args[0] || 'all';
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const pos = args.filter((a) => !a.startsWith('--'));
  const getOpt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
  };
  return {
    cmd,
    detect: flags.has('--detect') || !flags.has('--no-detect'),
    writeMcp: flags.has('--write-mcp'),
    noWriteMcp: flags.has('--no-write-mcp'),
    enableMcp: !flags.has('--no-mcp'),
    gatewayUrl: getOpt('--url') || getOpt('--gateway-url'),
    apiKey: getOpt('--api-key'),
    apiUrl: getOpt('--api-url'),
    apiToken: getOpt('--api-token'),
    userData: getOpt('--user-data') || process.env.AC_COMPANION_USER_DATA || null,
    pos,
  };
}

function readShellSettings(userDataDir) {
  const p = companionConnect.shellSettingsPathFromUserData(userDataDir);
  const fallback = {
    siteUrl: 'http://localhost:3000',
    scriptHubUrl: 'http://localhost:5173/',
    scriptHubApiUrl: 'http://localhost:8787/',
    scriptHubApiToken: '',
  };
  if (!fs.existsSync(p)) return fallback;
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch {
    return fallback;
  }
}

function writeShellSettings(userDataDir, patch) {
  const p = companionConnect.shellSettingsPathFromUserData(userDataDir);
  const cur = readShellSettings(userDataDir);
  const next = { ...cur, ...patch };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

function createCliContext(userDataDir) {
  const storeRoot = companionConnect.agentStoreRootFromUserData(userDataDir);
  const store = createAgentStore({ getRoot: () => storeRoot });
  store.ensureLayout();
  return {
    readAgentSettings: () => store.readSettings(),
    writeAgentSettings: (patch) => store.writeSettings(patch),
    readShellSettings: () => readShellSettings(userDataDir),
    writeShellSettings: (patch) => writeShellSettings(userDataDir, patch),
    buildMcpClientConfig: () => companionConnect.buildMcpClientConfigFromSettings(store.readSettings()),
    getExportRoot: () => path.join(storeRoot, 'connect-exports'),
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const userDataDir = opts.userData
    ? path.resolve(opts.userData)
    : companionConnect.defaultCompanionUserDataDir();
  const ctx = createCliContext(userDataDir);

  const connectOpts = {
    detect: opts.detect,
    gatewayUrl: opts.gatewayUrl,
    apiKey: opts.apiKey,
    apiUrl: opts.apiUrl,
    apiToken: opts.apiToken,
    writeMcp: opts.writeMcp || (!opts.noWriteMcp && opts.cmd !== 'scripthub'),
    enableMcp: opts.enableMcp,
    connectScriptHub: opts.cmd === 'all' || opts.cmd === 'scripthub',
  };

  console.log(`[companion-connect] userData=${userDataDir}`);
  console.log(`[companion-connect] command=${opts.cmd}`);

  let result;
  if (opts.cmd === 'hermes') {
    result = await companionConnect.connectExistingHermes(ctx, connectOpts);
  } else if (opts.cmd === 'scripthub') {
    result = await companionConnect.connectScriptHub(ctx, connectOpts);
  } else if (opts.cmd === 'all' || opts.cmd === 'connect') {
    result = await companionConnect.connectAll(ctx, connectOpts);
  } else if (opts.cmd === 'detect') {
    const hermes = await companionConnect.detectHermesGateway(connectOpts);
    const sh = await companionConnect.detectScriptHubBridge(connectOpts);
    result = { ok: hermes.ok || sh.ok, hermes, scriptHub: sh };
  } else {
    console.error(`Unknown command: ${opts.cmd}`);
    process.exit(2);
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result && result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
