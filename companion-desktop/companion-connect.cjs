'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomBytes } = require('node:crypto');
const hermesGatewayHost = require('./hermes-gateway-host.cjs');
const companionSandboxPaths = require('./companion-sandbox-paths.cjs');
const { ALL_TOOL_SCHEMAS } = require('./agent-tool-schemas.cjs');
const {
  DEFAULT_CODEX_MCP_TOKEN_ENV,
  upsertCodexMcpServerFromClientConfig,
} = require('./codex-mcp-config.cjs');

const DEFAULT_HERMES_API_KEY = 'hermes-local';
const DEFAULT_SCRIPT_HUB_API = 'http://localhost:8787/';
const EXPORT_DIR_NAME = 'connect-exports';

/** @type {Array<{ url: string; apiKey: string; source: string }>} */
const HERMES_DETECT_CANDIDATES = [
  { url: 'http://127.0.0.1:8642/v1', apiKey: '', source: 'official-default' },
  { url: 'http://localhost:8642/v1', apiKey: '', source: 'official-localhost' },
  { url: 'http://127.0.0.1:19119/v1', apiKey: DEFAULT_HERMES_API_KEY, source: 'default-dev' },
  { url: 'http://localhost:19119/v1', apiKey: DEFAULT_HERMES_API_KEY, source: 'localhost-dev' },
  { url: 'http://127.0.0.1:8080/v1', apiKey: DEFAULT_HERMES_API_KEY, source: 'alt-8080' },
  { url: 'http://127.0.0.1:3001/v1', apiKey: DEFAULT_HERMES_API_KEY, source: 'alt-3001' },
];

/** @type {string[]} */
const SCRIPT_HUB_DETECT_CANDIDATES = [
  'http://127.0.0.1:8787/',
  'http://localhost:8787/',
];

function defaultCompanionUserDataDir() {
  if (process.env.AC_COMPANION_USER_DATA && String(process.env.AC_COMPANION_USER_DATA).trim()) {
    return path.resolve(String(process.env.AC_COMPANION_USER_DATA).trim());
  }
  const sandboxUserData = companionSandboxPaths.getDesktopShellUserDataPath();
  if (sandboxUserData) return sandboxUserData;
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'AssetCutterCompanion');
}

function agentStoreRootFromUserData(userDataDir) {
  const sandbox = process.env.AC_COMPANION_SANDBOX_ROOT;
  if (sandbox && String(sandbox).trim()) {
    return path.join(path.resolve(String(sandbox).trim()), 'agent-store');
  }
  const sandboxUserData = companionSandboxPaths.getDesktopShellUserDataPath();
  const sandboxStore = companionSandboxPaths.getAgentStoreRoot();
  if (sandboxUserData && sandboxStore && path.resolve(userDataDir) === path.resolve(sandboxUserData)) {
    return sandboxStore;
  }
  return path.join(userDataDir, 'agent-store');
}

function shellSettingsPathFromUserData(userDataDir) {
  return path.join(userDataDir, 'companion-shell-settings.json');
}

function hermesMcpConfigCandidatePaths() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return [
    path.join(appData, 'Hermes', 'mcp.json'),
    path.join(appData, 'hermes', 'mcp.json'),
    path.join(home, '.hermes', 'mcp.json'),
    path.join(home, '.config', 'hermes', 'mcp.json'),
  ];
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readHermesApiKeyFromEnv() {
  try {
    const { readHermesEnvValue } = require('./hermes-cli-resolve.cjs');
    return readHermesEnvValue('API_SERVER_KEY');
  } catch {
    return '';
  }
}

async function detectHermesGateway(options) {
  const opts = options && typeof options === 'object' ? options : {};
  /** @type {Array<{ url: string; apiKey: string; source: string }>} */
  const candidates = [];

  if (opts.gatewayUrl) {
    candidates.push({
      url: String(opts.gatewayUrl).trim().replace(/\/$/, ''),
      apiKey: String(opts.apiKey || DEFAULT_HERMES_API_KEY).trim(),
      source: 'explicit',
    });
  }

  if (opts.detect !== false) {
    const envKey = readHermesApiKeyFromEnv();
    if (envKey) {
      candidates.push({
        url: 'http://127.0.0.1:8642/v1',
        apiKey: envKey,
        source: 'hermes-env',
      });
    }
    for (const c of HERMES_DETECT_CANDIDATES) candidates.push({ ...c });
    if (process.env.COMPANION_AGENT_HERMES_BASE_URL) {
      candidates.push({
        url: String(process.env.COMPANION_AGENT_HERMES_BASE_URL).trim().replace(/\/$/, ''),
        apiKey: String(process.env.COMPANION_AGENT_HERMES_API_KEY || DEFAULT_HERMES_API_KEY).trim(),
        source: 'env',
      });
    }
    for (const cfgPath of hermesMcpConfigCandidatePaths()) {
      if (!fs.existsSync(cfgPath)) continue;
      const j = readJsonFile(cfgPath, null);
      if (!j || typeof j !== 'object') continue;
      const servers = j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : j;
      for (const val of Object.values(servers)) {
        if (!val || typeof val !== 'object') continue;
        const base = val.gatewayUrl || val.baseUrl || val.url;
        if (typeof base === 'string' && base.includes('/v1')) {
          candidates.push({
            url: base.replace(/\/$/, ''),
            apiKey: String(val.apiKey || val.token || DEFAULT_HERMES_API_KEY).trim(),
            source: `config:${cfgPath}`,
          });
        }
      }
    }
  }

  const seen = new Set();
  /** @type {Array<{ url: string; apiKey: string; source: string; probe: object }>} */
  const hits = [];
  for (const c of candidates) {
    const url = c.url.endsWith('/v1') ? c.url : `${c.url.replace(/\/$/, '')}/v1`;
    const key = `${url}|${c.apiKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const probe = await hermesGatewayHost.probeGateway(url, c.apiKey);
    if (probe.ok) hits.push({ url, apiKey: c.apiKey, source: c.source, probe });
  }
  return { ok: hits.length > 0, hits, best: hits[0] || null };
}

async function detectScriptHubBridge(options) {
  const opts = options && typeof options === 'object' ? options : {};
  /** @type {string[]} */
  const urls = [];
  if (opts.apiUrl) urls.push(String(opts.apiUrl).trim());
  if (opts.detect !== false) {
    for (const u of SCRIPT_HUB_DETECT_CANDIDATES) urls.push(u);
    if (process.env.SCRIPTHUB_TOOL_BRIDGE_URL) urls.push(String(process.env.SCRIPTHUB_TOOL_BRIDGE_URL).trim());
  }
  const seen = new Set();
  /** @type {Array<{ apiUrl: string; probe: object }>} */
  const hits = [];
  for (const raw of urls) {
    const base = raw.replace(/\/+$/, '') + '/';
    if (seen.has(base)) continue;
    seen.add(base);
    try {
      const r = await fetch(`${base}health`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        hits.push({ apiUrl: base, probe: { ok: true, detail: `scriptHub ${base}` } });
      }
    } catch (e) {
      /* skip */
    }
  }
  return { ok: hits.length > 0, hits, best: hits[0] || null };
}

function buildMcpClientConfigFromSettings(settings) {
  const port = Number(settings && settings.mcpPort) || 19120;
  const token = settings && settings.mcpToken ? String(settings.mcpToken) : '<generate-in-companion-settings>';
  return {
    mcpServers: {
      'assetcutter-body': {
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  };
}

function buildConnectBundle(ctx) {
  const agentSettings = ctx.readAgentSettings();
  const shellSettings = ctx.readShellSettings();
  const toolCount = Array.isArray(ALL_TOOL_SCHEMAS) ? ALL_TOOL_SCHEMAS.length : 0;
  const mcpConfig =
    typeof ctx.buildMcpClientConfig === 'function'
      ? ctx.buildMcpClientConfig()
      : buildMcpClientConfigFromSettings(agentSettings);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    hermes: {
      gatewayUrl: agentSettings.hermesGatewayUrl,
      apiKey: agentSettings.hermesApiKey,
      model: agentSettings.hermesModel || 'default',
      managedGateway: Boolean(agentSettings.hermesManagedGateway),
    },
    mcp: mcpConfig,
    scriptHub: {
      uiUrl: shellSettings.scriptHubUrl,
      apiUrl: shellSettings.scriptHubApiUrl,
      apiToken: shellSettings.scriptHubApiToken || null,
      integrationVersion: 2,
    },
    instructions: [
      `在 Hermes / Codex / Pi 等 MCP 客户端中导入 mcp 配置，即可调用 AssetCutter 平台 ${toolCount} 个 ac.* 身体工具。`,
      'ScriptHub Tool Bridge 地址见 scriptHub.apiUrl；伴侣 Copilot 已通过 ac.script_hub.* 对齐。',
      '壳内 Copilot 对话无需外部桌面 UI；外部 agent 经 MCP 共用同一身体、权限策略和审计。',
      '外部 agent 应先读取 assetcutter://mcp/server-status 和 assetcutter://mcp/tool-catalog；工作台任务统一从 ac.workbench.ensure_ready 开始，再执行 run_capability/list_assets/get_asset。',
      '导入后可运行 npm run smoke:agent-mcp -- --config <hermes-mcp-import.json> 验证连接。',
      '工作台已登录后，可运行 npm run smoke:agent-mcp:e2e -- --config <hermes-mcp-import.json> 验证创建项目、执行能力、读回资产的完整闭环。',
    ],
  };
}

function mergeMcpConfig(existing, incoming) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  if (!base.mcpServers || typeof base.mcpServers !== 'object') base.mcpServers = {};
  const inc = incoming && incoming.mcpServers ? incoming.mcpServers : {};
  base.mcpServers = { ...base.mcpServers, ...inc };
  return base;
}

function writeHermesMcpImport(mcpConfig, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const written = [];
  const skipped = [];
  const paths = Array.isArray(opts.paths) && opts.paths.length ? opts.paths : hermesMcpConfigCandidatePaths();
  for (const p of paths) {
    try {
      const cur = fs.existsSync(p) ? readJsonFile(p, {}) : {};
      const next = mergeMcpConfig(cur, mcpConfig);
      writeJsonFile(p, next);
      written.push(p);
    } catch (e) {
      skipped.push({ path: p, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { written, skipped };
}

function writeCodexMcpConfig(mcpConfig, options) {
  const opts = options && typeof options === 'object' ? options : {};
  try {
    const result = upsertCodexMcpServerFromClientConfig(mcpConfig, {
      codexHome: opts.codexHome,
      configPath: opts.configPath,
      name: opts.name,
      tokenEnvVar: opts.tokenEnvVar || DEFAULT_CODEX_MCP_TOKEN_ENV,
    });
    return { ok: true, written: result.path ? [result.path] : [], skipped: [], result };
  } catch (e) {
    return {
      ok: false,
      written: [],
      skipped: [
        {
          path: opts.configPath || opts.codexHome || 'codex-config',
          error: e instanceof Error ? e.message : String(e),
        },
      ],
    };
  }
}

function exportConnectBundle(exportRoot, bundle) {
  ensureDir(exportRoot);
  const bundlePath = path.join(exportRoot, 'assetcutter-connect-bundle.json');
  const mcpPath = path.join(exportRoot, 'hermes-mcp-import.json');
  writeJsonFile(bundlePath, bundle);
  writeJsonFile(mcpPath, bundle.mcp);
  return { bundlePath, mcpPath, exportRoot };
}

function ensureMcpTokenInSettings(writeAgentSettings, readAgentSettings) {
  const cur = readAgentSettings();
  if (cur.mcpToken && String(cur.mcpToken).length >= 16) return cur;
  const token = randomBytes(24).toString('hex');
  return writeAgentSettings({ mcpToken: token, mcpEnabled: true });
}

function exportCurrentConnectionBundle(ctx, options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (opts.enableMcp !== false) {
    ctx.writeAgentSettings({ mcpEnabled: true });
    ensureMcpTokenInSettings(ctx.writeAgentSettings.bind(ctx), ctx.readAgentSettings.bind(ctx));
  }
  const bundle = buildConnectBundle(ctx);
  const exportRoot =
    typeof ctx.getExportRoot === 'function'
      ? ctx.getExportRoot()
      : path.join(agentStoreRootFromUserData(defaultCompanionUserDataDir()), EXPORT_DIR_NAME);
  const exported = exportConnectBundle(exportRoot, bundle);
  const mcpWrite = opts.writeMcp ? writeHermesMcpImport(bundle.mcp, { paths: opts.mcpPaths }) : { written: [], skipped: [] };
  const codexMcpWrite = opts.writeCodexMcp
    ? writeCodexMcpConfig(bundle.mcp, {
        codexHome: opts.codexHome,
        configPath: opts.codexConfigPath,
        tokenEnvVar: opts.codexTokenEnvVar,
      })
    : { ok: true, written: [], skipped: [] };
  return { bundle, exported, mcpWrite, codexMcpWrite };
}

/**
 * @param {{
 *   readAgentSettings: () => object;
 *   writeAgentSettings: (patch: object) => object;
 *   readShellSettings: () => object;
 *   writeShellSettings: (patch: object) => object;
 *   buildMcpClientConfig?: () => object;
 *   syncMcp?: () => Promise<void>;
 *   getExportRoot?: () => string;
 * }} ctx
 * @param {object} [options]
 */
async function connectExistingHermes(ctx, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const detect = await detectHermesGateway({
    detect: opts.detect !== false,
    gatewayUrl: opts.gatewayUrl,
    apiKey: opts.apiKey,
  });
  if (!detect.best) {
    return { ok: false, error: '未检测到可用的 Hermes Gateway', detect };
  }
  const hit = detect.best;
  let apiKey = hit.apiKey;
  if (!apiKey && ctx.getHermesRuntime) {
    const rt = ctx.getHermesRuntime();
    if (rt && rt.apiKey) apiKey = String(rt.apiKey);
  }
  const agentPatch = {
    hermesGatewayUrl: hit.url,
    hermesApiKey: apiKey,
    hermesManagedGateway: false,
    hermesGatewayKind: hit.url.includes(':8642') ? 'official' : 'dev',
    defaultBrainId: 'hermes',
    brainSetupCompleted: true,
  };
  agentPatch.mcpEnabled = true;
  let settings = ctx.writeAgentSettings(agentPatch);
  settings = ensureMcpTokenInSettings(ctx.writeAgentSettings.bind(ctx), ctx.readAgentSettings.bind(ctx));

  let scriptHub = null;
  if (opts.connectScriptHub !== false) {
    scriptHub = await connectScriptHub(ctx, { detect: true, ...opts });
  }

  const bundle = buildConnectBundle(ctx);
  const exportRoot =
    typeof ctx.getExportRoot === 'function'
      ? ctx.getExportRoot()
      : path.join(agentStoreRootFromUserData(defaultCompanionUserDataDir()), EXPORT_DIR_NAME);
  const exported = exportConnectBundle(exportRoot, bundle);

  const mcpWrite = writeHermesMcpImport(bundle.mcp, { paths: opts.mcpPaths });
  const codexMcpWrite = writeCodexMcpConfig(bundle.mcp, {
    codexHome: opts.codexHome,
    configPath: opts.codexConfigPath,
    tokenEnvVar: opts.codexTokenEnvVar,
  });

  return {
    ok: true,
    detect,
    settings,
    scriptHub,
    bundle,
    exported,
    mcpWrite,
    codexMcpWrite,
    message: '已连接已有 Hermes Gateway，并写入 MCP / ScriptHub 配置',
  };
}

async function connectScriptHub(ctx, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const detect = await detectScriptHubBridge({
    detect: opts.detect !== false,
    apiUrl: opts.apiUrl,
  });
  const patch = {};
  if (detect.best) patch.scriptHubApiUrl = detect.best.apiUrl;
  if (opts.apiUrl) patch.scriptHubApiUrl = String(opts.apiUrl).trim();
  if (typeof opts.apiToken === 'string') patch.scriptHubApiToken = opts.apiToken.trim();
  const shellSettings = Object.keys(patch).length ? ctx.writeShellSettings(patch) : ctx.readShellSettings();
  const ok = Boolean(detect.best || patch.scriptHubApiUrl);
  if (detect.best) {
    ctx.writeAgentSettings({ brainSetupCompleted: true });
  }
  return {
    ok,
    reachable: Boolean(detect.best),
    detect,
    shellSettings,
  };
}

/**
 * @param {object} ctx
 * @param {object} [options]
 */
async function connectAll(ctx, options) {
  const hermes = await connectExistingHermes(ctx, options);
  if (!hermes.ok) return hermes;
  return { ...hermes, mode: 'all' };
}

module.exports = {
  DEFAULT_HERMES_API_KEY,
  DEFAULT_SCRIPT_HUB_API,
  defaultCompanionUserDataDir,
  agentStoreRootFromUserData,
  shellSettingsPathFromUserData,
  detectHermesGateway,
  detectScriptHubBridge,
  buildConnectBundle,
  buildMcpClientConfigFromSettings,
  writeHermesMcpImport,
  writeCodexMcpConfig,
  exportConnectBundle,
  exportCurrentConnectionBundle,
  connectExistingHermes,
  connectScriptHub,
  connectAll,
  hermesMcpConfigCandidatePaths,
};
