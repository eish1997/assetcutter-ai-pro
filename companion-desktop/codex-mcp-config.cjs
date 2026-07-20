'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_CODEX_MCP_SERVER_NAME = 'assetcutter-body';
const DEFAULT_CODEX_MCP_TOKEN_ENV = 'ASSETCUTTER_MCP_TOKEN';

function defaultCodexHome() {
  const envHome = String(process.env.CODEX_HOME || '').trim();
  if (envHome) return envHome;
  return path.join(os.homedir(), '.codex');
}

function codexConfigPath(codexHome) {
  return path.join(codexHome || defaultCodexHome(), 'config.toml');
}

function tomlString(value) {
  return JSON.stringify(String(value || ''));
}

function removeTomlTableBlock(text, tableName) {
  const src = String(text || '');
  const lines = src.split(/\r?\n/);
  const out = [];
  let skipping = false;
  const exact = `[${tableName}]`;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === exact) {
      skipping = true;
      continue;
    }
    if (skipping && /^\[[^\]]+\]\s*$/.test(trimmed)) {
      skipping = false;
    }
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function buildCodexMcpTomlBlock(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const name = String(opts.name || DEFAULT_CODEX_MCP_SERVER_NAME).trim() || DEFAULT_CODEX_MCP_SERVER_NAME;
  const url = String(opts.url || '').trim();
  if (!url) throw new Error('codex_mcp_url_required');
  const tokenEnv = String(opts.tokenEnvVar || DEFAULT_CODEX_MCP_TOKEN_ENV).trim() || DEFAULT_CODEX_MCP_TOKEN_ENV;
  return [
    `[mcp_servers.${name}]`,
    `url = ${tomlString(url)}`,
    `bearer_token_env_var = ${tomlString(tokenEnv)}`,
  ].join('\n');
}

function upsertCodexMcpServerConfig(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const home = opts.codexHome ? path.resolve(String(opts.codexHome)) : defaultCodexHome();
  const file = opts.configPath ? path.resolve(String(opts.configPath)) : codexConfigPath(home);
  const name = String(opts.name || DEFAULT_CODEX_MCP_SERVER_NAME).trim() || DEFAULT_CODEX_MCP_SERVER_NAME;
  const tableName = `mcp_servers.${name}`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const withoutBlock = removeTomlTableBlock(current, tableName);
  const block = buildCodexMcpTomlBlock({ ...opts, name });
  const next = `${withoutBlock ? `${withoutBlock}\n\n` : ''}${block}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (current === next) {
    return { ok: true, changed: false, path: file, serverName: name, tokenEnvVar: opts.tokenEnvVar || DEFAULT_CODEX_MCP_TOKEN_ENV };
  }
  fs.writeFileSync(file, next, 'utf8');
  return { ok: true, changed: true, path: file, serverName: name, tokenEnvVar: opts.tokenEnvVar || DEFAULT_CODEX_MCP_TOKEN_ENV };
}

function codexMcpConfigFromMcpClientConfig(mcpConfig, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const servers = mcpConfig && mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object' ? mcpConfig.mcpServers : {};
  const entry = servers[opts.sourceServerName || DEFAULT_CODEX_MCP_SERVER_NAME] || Object.values(servers)[0];
  if (!entry || typeof entry !== 'object' || !entry.url) {
    throw new Error('assetcutter_mcp_config_missing');
  }
  return {
    name: opts.name || DEFAULT_CODEX_MCP_SERVER_NAME,
    url: String(entry.url),
    tokenEnvVar: opts.tokenEnvVar || DEFAULT_CODEX_MCP_TOKEN_ENV,
    codexHome: opts.codexHome,
    configPath: opts.configPath,
  };
}

function upsertCodexMcpServerFromClientConfig(mcpConfig, options) {
  return upsertCodexMcpServerConfig(codexMcpConfigFromMcpClientConfig(mcpConfig, options));
}

module.exports = {
  DEFAULT_CODEX_MCP_SERVER_NAME,
  DEFAULT_CODEX_MCP_TOKEN_ENV,
  codexConfigPath,
  buildCodexMcpTomlBlock,
  upsertCodexMcpServerConfig,
  codexMcpConfigFromMcpClientConfig,
  upsertCodexMcpServerFromClientConfig,
};
