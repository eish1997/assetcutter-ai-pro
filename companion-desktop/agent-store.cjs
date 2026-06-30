'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');

const SCHEMA_VERSION = 1;
const BODY_TOOLS_VERSION = 2;
const DEFAULT_SESSION_ID = 'default';

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * @param {{ getRoot: () => string }} deps
 */
function createAgentStore(deps) {
  function rootDir() {
    const r = deps.getRoot();
    ensureDir(r);
    return r;
  }

  function manifestPath() {
    return path.join(rootDir(), 'manifest.json');
  }

  function settingsPath() {
    return path.join(rootDir(), 'settings.json');
  }

  function profilePath() {
    return path.join(rootDir(), 'profile.yaml');
  }

  function skillsDir() {
    const dir = path.join(rootDir(), 'skills');
    ensureDir(dir);
    return dir;
  }

  function memoryDir() {
    const dir = path.join(rootDir(), 'memory');
    ensureDir(dir);
    return dir;
  }

  function brainsDir() {
    const dir = path.join(rootDir(), 'brains');
    ensureDir(dir);
    return dir;
  }

  function ensureLayout() {
    const root = rootDir();
    ensureDir(path.join(root, 'sessions'));
    ensureDir(path.join(root, 'audit'));
    skillsDir();
    memoryDir();
    brainsDir();
    if (!fs.existsSync(manifestPath())) {
      fs.writeFileSync(
        manifestPath(),
        `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, bodyToolsVersion: BODY_TOOLS_VERSION }, null, 2)}\n`,
        'utf8',
      );
    }
    if (!fs.existsSync(profilePath())) {
      fs.writeFileSync(
        profilePath(),
        'system: |\n  你是 AssetCutter 本地伴侣助手。用简洁中文回答。\n  可通过 ac.* 工具切换壳页面、查询伴侣与本机引擎状态。\n',
        'utf8',
      );
    }
    seedDefaultSkillsIfEmpty();
  }

  function seedDefaultSkillsIfEmpty() {
    const dir = skillsDir();
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
    if (entries.length > 0) return;
    const sampleDir = path.join(dir, 'navigate-scripts');
    ensureDir(sampleDir);
    fs.writeFileSync(
      path.join(sampleDir, 'skill.json'),
      `${JSON.stringify(
        {
          id: 'navigate-scripts',
          name: '打开脚本页',
          description: '需要 Script Hub 时切换到 scripts 视图',
          toolHints: ['ac.shell.navigate'],
          prompt: '当用户要查看或运行脚本库时，先 ac.shell.navigate {"view":"scripts"}。',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }

  function readSettings() {
    ensureLayout();
    const defaults = {
      defaultBrainId: 'hermes',
      copilotWidth: 360,
      copilotCollapsed: false,
      defaultSessionId: DEFAULT_SESSION_ID,
      mcpEnabled: false,
      mcpPort: 19120,
      mcpToken: null,
    };
    try {
      const j = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
      return {
        ...defaults,
        ...j,
        copilotWidth: Number.isFinite(Number(j.copilotWidth))
          ? Math.min(640, Math.max(240, Number(j.copilotWidth)))
          : defaults.copilotWidth,
        copilotCollapsed: Boolean(j.copilotCollapsed),
        mcpEnabled: Boolean(j.mcpEnabled),
        mcpPort: Number.isFinite(Number(j.mcpPort))
          ? Math.min(65535, Math.max(1024, Number(j.mcpPort)))
          : defaults.mcpPort,
        mcpToken: j.mcpToken != null ? String(j.mcpToken) : null,
      };
    } catch {
      return { ...defaults };
    }
  }

  function writeSettings(patch) {
    const cur = readSettings();
    const next = { ...cur, ...patch };
    fs.writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  function readProfileSystemPrompt() {
    ensureLayout();
    try {
      const raw = fs.readFileSync(profilePath(), 'utf8');
      const m = raw.match(/system:\s*\|\s*\n([\s\S]*)/);
      let base = '你是 AssetCutter 本地伴侣助手。';
      if (m) {
        base = m[1]
          .split('\n')
          .map((line) => line.replace(/^\s{2}/, ''))
          .join('\n')
          .trim();
      } else {
        base = raw.trim();
      }
      try {
        const { buildSkillsContextBlock } = require('./agent-skills.cjs');
        const { buildMemoryContextBlock } = require('./agent-memory.cjs');
        const skillBlock = buildSkillsContextBlock(skillsDir());
        const memBlock = buildMemoryContextBlock(memoryDir());
        const parts = [base];
        if (skillBlock) parts.push(skillBlock);
        if (memBlock) parts.push(memBlock);
        return parts.join('\n\n');
      } catch {
        return base;
      }
    } catch {
      return '你是 AssetCutter 本地伴侣助手。';
    }
  }

  function writeBrainMeta(brainId, meta) {
    const id = String(brainId || '').trim();
    if (!id) return null;
    const file = path.join(brainsDir(), `${id}.json`);
    const payload = {
      id,
      updatedAt: new Date().toISOString(),
      ...(meta && typeof meta === 'object' ? meta : {}),
    };
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return payload;
  }

  function listBrainMetas() {
    ensureLayout();
    const out = [];
    for (const f of fs.readdirSync(brainsDir())) {
      if (!f.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(brainsDir(), f), 'utf8')));
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  function sessionDir(sessionId) {
    const id = String(sessionId || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID;
    const dir = path.join(rootDir(), 'sessions', id);
    ensureDir(dir);
    return dir;
  }

  function readMessages(sessionId) {
    const file = path.join(sessionDir(sessionId), 'messages.jsonl');
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    const out = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line));
      } catch {
        /* skip bad line */
      }
    }
    return out;
  }

  function appendMessage(sessionId, msg) {
    const file = path.join(sessionDir(sessionId), 'messages.jsonl');
    const line = `${JSON.stringify(msg)}\n`;
    fs.appendFileSync(file, line, 'utf8');
  }

  function writeContextSnapshot(sessionId, snapshot) {
    const file = path.join(sessionDir(sessionId), 'context-snapshot.json');
    fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  function appendAudit(entry) {
    ensureLayout();
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(rootDir(), 'audit', `${day}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  function getOrCreateDefaultSessionId() {
    return readSettings().defaultSessionId || DEFAULT_SESSION_ID;
  }

  function newMessage(role, content, extra) {
    return {
      id: `msg_${randomUUID()}`,
      role,
      content: String(content || ''),
      meta: { ts: new Date().toISOString(), ...(extra || {}) },
    };
  }

  return {
    ensureLayout,
    readSettings,
    writeSettings,
    readProfileSystemPrompt,
    readMessages,
    appendMessage,
    writeContextSnapshot,
    appendAudit,
    getOrCreateDefaultSessionId,
    newMessage,
    skillsDir,
    memoryDir,
    brainsDir,
    writeBrainMeta,
    listBrainMetas,
    DEFAULT_SESSION_ID,
  };
}

module.exports = { createAgentStore, DEFAULT_SESSION_ID };
