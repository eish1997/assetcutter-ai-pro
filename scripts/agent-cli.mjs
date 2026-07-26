#!/usr/bin/env node
/**
 * AssetCutter Agent CLI — cloud API only. No MCP / companion imports.
 *
 *   npm run agent:cli -- login
 *   npm run agent:cli -- whoami
 *   npm run agent:cli -- project create "测试"
 *   npm run agent:cli -- run --prompt "一只猫"
 *   npm run agent:cli -- assets list
 *   npm run agent:cli -- audit
 *   npm run agent:init
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function configDir() {
  const override = String(process.env.ASSETCUTTER_AGENT_CLI_HOME || '').trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.assetcutter', 'agent-cli');
}

function configPath() {
  return path.join(configDir(), 'credentials.json');
}

function readCreds() {
  const p = configPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeCreds(patch) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  const next = { ...readCreds(), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  try {
    fs.chmodSync(configPath(), 0o600);
  } catch {
    /* windows */
  }
  return next;
}

function apiBase() {
  const fromEnv = String(process.env.ASSETCUTTER_API_BASE || process.env.VITE_AUTH_API_BASE_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const creds = readCreds();
  if (creds.apiBase) return String(creds.apiBase).replace(/\/+$/, '');
  return 'http://127.0.0.1:9100';
}

function token() {
  return String(process.env.ASSETCUTTER_AGENT_TOKEN || readCreds().token || '').trim();
}

async function api(method, pathName, body) {
  const headers = { Accept: 'application/json' };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${apiBase()}${pathName}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(json?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      pos.push(a);
    }
  }
  return { cmd: pos[0] || 'help', pos, flags };
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

async function cmdLogin(flags) {
  if (flags.token) {
    writeCreds({ token: String(flags.token), apiBase: apiBase() });
    const me = await api('GET', '/api/agent/cli/whoami');
    printJson({ ok: true, mode: 'token', ...me, credentialsPath: configPath() });
    return;
  }
  const siteUrl = String(flags.site || process.env.PUBLIC_SITE_URL || 'http://localhost:3000');
  writeCreds({ apiBase: apiBase() });
  const start = await api('POST', '/api/agent/cli/device/start', { siteUrl });
  console.log(`[agent-cli] Open this URL while logged in to AssetCutter:\n  ${start.verificationUrl}`);
  console.log(`[agent-cli] User code: ${start.userCode}`);
  if (flags['no-open'] !== true) {
    try {
      openBrowser(start.verificationUrl);
    } catch {
      /* ignore */
    }
  }
  const deadline = Date.now() + (Number(start.expiresIn) || 900) * 1000;
  const interval = Math.max(2, Number(start.interval) || 2) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const poll = await api('POST', '/api/agent/cli/device/poll', { deviceCode: start.deviceCode });
    if (poll.status === 'pending') {
      process.stdout.write('.');
      continue;
    }
    if (poll.status === 'approved' && poll.token) {
      process.stdout.write('\n');
      writeCreds({
        token: poll.token,
        apiBase: apiBase(),
        userId: poll.userId,
        username: poll.username,
        patId: poll.patId,
      });
      printJson({
        ok: true,
        mode: 'device',
        userId: poll.userId,
        username: poll.username,
        patId: poll.patId,
        credentialsPath: configPath(),
        message: 'Login OK. Token saved (never commit this file).',
      });
      return;
    }
  }
  throw new Error('Login timed out. Re-run: npm run agent:cli -- login');
}

async function cmdWhoami() {
  printJson(await api('GET', '/api/agent/cli/whoami'));
}

async function cmdProject(pos, flags) {
  const sub = pos[1] || 'list';
  if (sub === 'list') {
    printJson(await api('GET', '/api/agent/cli/projects'));
    return;
  }
  if (sub === 'create') {
    const name = flags.name || pos[2] || 'Agent project';
    printJson(await api('POST', '/api/agent/cli/projects', { name }));
    return;
  }
  throw new Error('Usage: project list | project create [name]');
}

async function cmdRun(flags) {
  const prompt = String(flags.prompt || flags.p || '').trim();
  if (!prompt) throw new Error('Usage: run --prompt "..." [--project-id ID] [--preset text-to-image]');
  printJson(
    await api('POST', '/api/agent/cli/run', {
      prompt,
      projectId: flags['project-id'] || flags.projectId || undefined,
      projectName: flags['project-name'] || undefined,
      presetId: flags.preset || flags['preset-id'] || 'text-to-image',
      wait: flags['no-wait'] ? false : true,
    }),
  );
}

async function cmdAssets(pos, flags) {
  const sub = pos[1] || 'list';
  if (sub === 'list') {
    const q = new URLSearchParams();
    if (flags['project-id']) q.set('projectId', flags['project-id']);
    if (flags.limit) q.set('limit', String(flags.limit));
    const qs = q.toString() ? `?${q}` : '';
    printJson(await api('GET', `/api/agent/cli/assets${qs}`));
    return;
  }
  if (sub === 'get') {
    const assetId = flags.id || pos[2];
    if (!assetId) throw new Error('Usage: assets get --id <assetId>');
    printJson(await api('POST', '/api/agent/cli/assets/get', { assetId }));
    return;
  }
  throw new Error('Usage: assets list | assets get --id ID');
}

async function cmdAudit(flags) {
  const q = flags.limit ? `?limit=${encodeURIComponent(flags.limit)}` : '';
  printJson(await api('GET', `/api/agent/cli/audit${q}`));
}

function writeCursorSkill() {
  const skillDir = path.join(ROOT, '.cursor', 'skills', 'assetcutter-agent-cli');
  fs.mkdirSync(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, 'SKILL.md');
  const body = `---
name: assetcutter-agent-cli
description: >-
  Operate AssetCutter platform projects/assets via Agent CLI only (no MCP).
  Use when the user asks to create projects, generate assets, or audit Agent CLI actions.
---

# AssetCutter Agent CLI

Do **not** use MCP or companion Body tools for platform assets.

## Setup (once)

\`\`\`powershell
npm run agent:init
\`\`\`

Credentials: \`~/.assetcutter/agent-cli/credentials.json\` (never commit; never print full token).

## Commands

\`\`\`powershell
npm run agent:cli -- whoami
npm run agent:cli -- project create "测试项目"
npm run agent:cli -- run --prompt "一只橘猫"
npm run agent:cli -- assets list
npm run agent:cli -- audit
\`\`\`

## Flow

1. \`whoami\` — confirm login
2. \`project create\` (optional; \`run\` auto-creates if omitted)
3. \`run --prompt "..."\` — waits until asset is created
4. \`assets list\` — verify platform list (\`source=agent-cli\`)
5. \`audit\` — verify audit entries

API base defaults to \`http://127.0.0.1:9100\` (override with \`ASSETCUTTER_API_BASE\`).
`;
  fs.writeFileSync(skillPath, body, 'utf8');
  return skillPath;
}

function writeAgentsHint() {
  const p = path.join(ROOT, 'docs', 'Cursor与Codex-Agent-CLI接入.md');
  const body = `# Cursor / Codex：Agent CLI 一发入魂

外部 Agent **只走 CLI**（云端 API）。MCP 产品面已移除。

## 两步

\`\`\`powershell
# 1) 确保 auth-api 在 9100（或设置 ASSETCUTTER_API_BASE）
npm run dev:auth-backend

# 2) 安装 + 浏览器登录一次
npm run agent:init
\`\`\`

## 验收话术（粘贴给 Cursor）

> 用 AssetCutter Agent CLI：先 whoami，再创建一个测试项目，run 一句文生图 prompt，然后 assets list 与 audit 确认资产和审计都在。

## 命令

| 命令 | 作用 |
|---|---|
| \`npm run agent:cli -- login\` | 设备码登录，保存 PAT |
| \`npm run agent:cli -- whoami\` | 当前用户 |
| \`npm run agent:cli -- project create "名"\` | 建项目 |
| \`npm run agent:cli -- run --prompt "..."\` | 生成并写入平台资产列表 |
| \`npm run agent:cli -- assets list\` | 列资产 |
| \`npm run agent:cli -- audit\` | 查审计 |

Token 路径：\`~/.assetcutter/agent-cli/credentials.json\`（勿提交 Git）。
`;
  fs.writeFileSync(p, body, 'utf8');
  return p;
}

async function cmdInit(flags) {
  const skillPath = writeCursorSkill();
  const docPath = writeAgentsHint();
  console.log(`[agent-init] Wrote Cursor skill: ${skillPath}`);
  console.log(`[agent-init] Wrote docs: ${docPath}`);
  console.log(`[agent-init] Starting login…`);
  await cmdLogin(flags);
  console.log(`
[agent-init] Done.
Next: paste this to Cursor/Codex —

用 AssetCutter Agent CLI：先 whoami，再创建一个测试项目，run 一句文生图 prompt，然后 assets list 与 audit 确认资产和审计都在。
`);
}

function help() {
  console.log(`AssetCutter Agent CLI (no MCP)

  npm run agent:init
  npm run agent:cli -- login [--token PAT] [--site URL] [--no-open]
  npm run agent:cli -- whoami
  npm run agent:cli -- project list|create [name]
  npm run agent:cli -- run --prompt "..." [--project-id ID]
  npm run agent:cli -- assets list|get
  npm run agent:cli -- audit

Env: ASSETCUTTER_API_BASE, ASSETCUTTER_AGENT_TOKEN, ASSETCUTTER_AGENT_CLI_HOME
Creds: ${configPath()}
`);
}

async function main() {
  const { cmd, pos, flags } = parseArgs(process.argv);
  try {
    if (cmd === 'help' || cmd === '-h' || cmd === '--help') return help();
    if (cmd === 'init') return await cmdInit(flags);
    if (cmd === 'login') return await cmdLogin(flags);
    if (cmd === 'whoami') return await cmdWhoami();
    if (cmd === 'project' || cmd === 'projects') return await cmdProject(pos, flags);
    if (cmd === 'run') return await cmdRun(flags);
    if (cmd === 'assets' || cmd === 'asset') return await cmdAssets(pos, flags);
    if (cmd === 'audit') return await cmdAudit(flags);
    help();
    process.exitCode = 1;
  } catch (e) {
    console.error(`[agent-cli] ${e instanceof Error ? e.message : String(e)}`);
    if (e && e.body) console.error(JSON.stringify(e.body, null, 2));
    process.exitCode = 1;
  }
}

await main();
