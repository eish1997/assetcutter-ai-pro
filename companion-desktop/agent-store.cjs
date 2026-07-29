'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');

const SCHEMA_VERSION = 1;
const BODY_TOOLS_VERSION = 7;
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
      defaultBrainId: 'codex',
      copilotWidth: 360,
      copilotCollapsed: false,
      defaultSessionId: DEFAULT_SESSION_ID,
      mcpEnabled: false,
      mcpPort: 19120,
      mcpToken: null,
      hermesGatewayUrl: 'http://127.0.0.1:8642/v1',
      hermesApiKey: '',
      hermesModel: 'hermes-agent',
      hermesManagedGateway: true,
      hermesGatewayKind: 'official',
      codexCommand: process.platform === 'win32' ? 'codex.cmd' : 'codex',
      codexCwd: path.resolve(__dirname, '..'),
      codexModel: '',
      codexSandbox: 'workspace-write',
      codexPermissionMode: 'ask',
      codexSharedAuthEnabled: false,
      codexSharedAuthUrl: '',
      codexSharedAuthToken: '',
      codexSharedAuthAutoUpdate: false,
      codexSharedAuthLastSyncAt: '',
      codexSharedAuthLastError: '',
      codexDefaultMigrated: false,
      brainSetupCompleted: false,
      mcpWorkbenchLastE2e: null,
    };
    try {
      const j = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
      return {
        ...defaults,
        ...j,
        copilotWidth: Number.isFinite(Number(j.copilotWidth))
          ? Math.min(720, Math.max(360, Number(j.copilotWidth)))
          : defaults.copilotWidth,
        copilotCollapsed: Boolean(j.copilotCollapsed),
        mcpEnabled: Boolean(j.mcpEnabled),
        mcpPort: Number.isFinite(Number(j.mcpPort))
          ? Math.min(65535, Math.max(1024, Number(j.mcpPort)))
          : defaults.mcpPort,
        mcpToken: j.mcpToken != null ? String(j.mcpToken) : null,
        hermesGatewayUrl:
          j.hermesGatewayUrl != null
            ? String(j.hermesGatewayUrl).trim().replace(/\/$/, '') || defaults.hermesGatewayUrl
            : defaults.hermesGatewayUrl,
        hermesApiKey: j.hermesApiKey != null ? String(j.hermesApiKey).trim() : defaults.hermesApiKey,
        hermesModel: j.hermesModel != null ? String(j.hermesModel).trim() : defaults.hermesModel,
        hermesManagedGateway:
          j.hermesManagedGateway != null ? Boolean(j.hermesManagedGateway) : defaults.hermesManagedGateway,
        hermesGatewayKind:
          j.hermesGatewayKind === 'dev' || j.hermesGatewayKind === 'official'
            ? j.hermesGatewayKind
            : defaults.hermesGatewayKind,
        codexCommand:
          j.codexCommand != null ? String(j.codexCommand).trim() || defaults.codexCommand : defaults.codexCommand,
        codexCwd:
          j.codexCwd != null ? String(j.codexCwd).trim() || defaults.codexCwd : defaults.codexCwd,
        codexModel: j.codexModel != null ? String(j.codexModel).trim() : defaults.codexModel,
        codexSandbox:
          j.codexSandbox === 'read-only' ||
          j.codexSandbox === 'workspace-write' ||
          j.codexSandbox === 'danger-full-access'
            ? j.codexSandbox
            : defaults.codexSandbox,
        codexPermissionMode:
          j.codexPermissionMode === 'ask' || j.codexPermissionMode === 'sandbox' || j.codexPermissionMode === 'full'
            ? j.codexPermissionMode
            : defaults.codexPermissionMode,
        codexSharedAuthEnabled:
          j.codexSharedAuthEnabled != null ? Boolean(j.codexSharedAuthEnabled) : defaults.codexSharedAuthEnabled,
        codexSharedAuthUrl:
          j.codexSharedAuthUrl != null ? String(j.codexSharedAuthUrl).trim() : defaults.codexSharedAuthUrl,
        codexSharedAuthToken:
          j.codexSharedAuthToken != null ? String(j.codexSharedAuthToken).trim() : defaults.codexSharedAuthToken,
        codexSharedAuthAutoUpdate:
          j.codexSharedAuthAutoUpdate != null
            ? Boolean(j.codexSharedAuthAutoUpdate)
            : defaults.codexSharedAuthAutoUpdate,
        codexSharedAuthLastSyncAt:
          j.codexSharedAuthLastSyncAt != null
            ? String(j.codexSharedAuthLastSyncAt).trim()
            : defaults.codexSharedAuthLastSyncAt,
        codexSharedAuthLastError:
          j.codexSharedAuthLastError != null
            ? String(j.codexSharedAuthLastError).trim()
            : defaults.codexSharedAuthLastError,
        codexDefaultMigrated:
          j.codexDefaultMigrated != null ? Boolean(j.codexDefaultMigrated) : defaults.codexDefaultMigrated,
        brainSetupCompleted: j.brainSetupCompleted != null ? Boolean(j.brainSetupCompleted) : defaults.brainSetupCompleted,
        mcpWorkbenchLastE2e:
          j.mcpWorkbenchLastE2e && typeof j.mcpWorkbenchLastE2e === 'object' ? j.mcpWorkbenchLastE2e : null,
      };
    } catch {
      return { ...defaults };
    }
  }

  function writeSettings(patch) {
    const cur = readSettings();
    const raw = patch && typeof patch === 'object' ? patch : {};
    const normalized = { ...raw };
    if (raw.hermesGatewayUrl != null) {
      const u = String(raw.hermesGatewayUrl).trim().replace(/\/$/, '');
      normalized.hermesGatewayUrl = u || cur.hermesGatewayUrl;
    }
    if (raw.hermesApiKey != null) {
      normalized.hermesApiKey = String(raw.hermesApiKey).trim();
    }
    if (raw.hermesModel != null) {
      normalized.hermesModel = String(raw.hermesModel).trim();
    }
    if (raw.hermesManagedGateway != null) {
      normalized.hermesManagedGateway = Boolean(raw.hermesManagedGateway);
    }
    if (raw.hermesGatewayKind != null) {
      const k = String(raw.hermesGatewayKind).trim();
      if (k === 'dev' || k === 'official') normalized.hermesGatewayKind = k;
    }
    if (raw.brainSetupCompleted != null) {
      normalized.brainSetupCompleted = Boolean(raw.brainSetupCompleted);
    }
    if (raw.codexCommand != null) {
      normalized.codexCommand = String(raw.codexCommand).trim() || cur.codexCommand;
    }
    if (raw.codexCwd != null) {
      normalized.codexCwd = String(raw.codexCwd).trim() || cur.codexCwd;
    }
    if (raw.codexModel != null) {
      normalized.codexModel = String(raw.codexModel).trim();
    }
    if (raw.codexSandbox != null) {
      const s = String(raw.codexSandbox).trim();
      if (s === 'read-only' || s === 'workspace-write' || s === 'danger-full-access') {
        normalized.codexSandbox = s;
      } else {
        delete normalized.codexSandbox;
      }
    }
    if (raw.codexPermissionMode != null) {
      const m = String(raw.codexPermissionMode).trim();
      if (m === 'ask' || m === 'sandbox' || m === 'full') {
        normalized.codexPermissionMode = m;
      } else {
        delete normalized.codexPermissionMode;
      }
    }
    if (raw.codexSharedAuthEnabled != null) {
      normalized.codexSharedAuthEnabled = Boolean(raw.codexSharedAuthEnabled);
    }
    if (raw.codexSharedAuthUrl != null) {
      normalized.codexSharedAuthUrl = String(raw.codexSharedAuthUrl).trim();
    }
    if (raw.codexSharedAuthToken != null) {
      normalized.codexSharedAuthToken = String(raw.codexSharedAuthToken).trim();
    }
    if (raw.codexSharedAuthAutoUpdate != null) {
      normalized.codexSharedAuthAutoUpdate = Boolean(raw.codexSharedAuthAutoUpdate);
    }
    if (raw.codexSharedAuthLastSyncAt != null) {
      normalized.codexSharedAuthLastSyncAt = String(raw.codexSharedAuthLastSyncAt).trim();
    }
    if (raw.codexSharedAuthLastError != null) {
      normalized.codexSharedAuthLastError = String(raw.codexSharedAuthLastError).trim();
    }
    if (raw.codexDefaultMigrated != null) {
      normalized.codexDefaultMigrated = Boolean(raw.codexDefaultMigrated);
    }
    if (raw.mcpWorkbenchLastE2e != null) {
      normalized.mcpWorkbenchLastE2e =
        raw.mcpWorkbenchLastE2e && typeof raw.mcpWorkbenchLastE2e === 'object' ? raw.mcpWorkbenchLastE2e : null;
    }
    const next = { ...cur, ...normalized };
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

  function clearMessages(sessionId) {
    const id = String(sessionId || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID;
    const dir = sessionDir(id);
    const file = path.join(dir, 'messages.jsonl');
    fs.writeFileSync(file, '', 'utf8');
    const snap = path.join(dir, 'context-snapshot.json');
    if (fs.existsSync(snap)) {
      try {
        fs.unlinkSync(snap);
      } catch {
        /* ignore */
      }
    }
    return { ok: true, sessionId: id };
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

  function readAuditEntries(options) {
    ensureLayout();
    const opts = options && typeof options === 'object' ? options : {};
    const days = Number.isFinite(Number(opts.days)) ? Math.min(90, Math.max(1, Number(opts.days))) : 7;
    const limit = Number.isFinite(Number(opts.limit)) ? Math.min(10000, Math.max(1, Number(opts.limit))) : 5000;
    const auditDir = path.join(rootDir(), 'audit');
    const wanted = new Set();
    const now = new Date();
    for (let i = 0; i < days; i += 1) {
      const d = new Date(now.getTime() - i * 86400000);
      wanted.add(d.toISOString().slice(0, 10));
    }
    const out = [];
    for (const f of fs.readdirSync(auditDir).filter((name) => name.endsWith('.jsonl')).sort()) {
      const day = f.replace(/\.jsonl$/, '');
      if (!wanted.has(day)) continue;
      const lines = fs.readFileSync(path.join(auditDir, f), 'utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        try {
          out.push(JSON.parse(line));
        } catch {
          /* skip */
        }
      }
    }
    return out.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || ''))).slice(0, limit);
  }

  function summarizeUsageAudit(options) {
    const entries = readAuditEntries(options);
    const totals = {
      turns: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      freshInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    };
    const bySessionMap = new Map();
    const byBrainMap = new Map();
    for (const entry of entries) {
      const usage = entry && entry.usage && typeof entry.usage === 'object' ? entry.usage : null;
      if (!usage) continue;
      const input = Number(usage.input_tokens) || 0;
      const cached = Math.min(input, Number(usage.cached_input_tokens) || 0);
      const output = Number(usage.output_tokens) || 0;
      const reasoning = Number(usage.reasoning_output_tokens) || 0;
      const total = Number(usage.total_tokens) || input + output + reasoning;
      const fresh = Math.max(0, input - cached);
      totals.turns += 1;
      totals.inputTokens += input;
      totals.cachedInputTokens += cached;
      totals.freshInputTokens += fresh;
      totals.outputTokens += output;
      totals.reasoningOutputTokens += reasoning;
      totals.totalTokens += total;
      const sessionId = String(entry.sessionId || 'default');
      const brainId = String(entry.brainId || 'unknown');
      const addRow = (map, key) => {
        const row = map.get(key) || {
          key,
          turns: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          freshInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
          lastAt: '',
        };
        row.turns += 1;
        row.inputTokens += input;
        row.cachedInputTokens += cached;
        row.freshInputTokens += fresh;
        row.outputTokens += output;
        row.reasoningOutputTokens += reasoning;
        row.totalTokens += total;
        if (String(entry.ts || '') > row.lastAt) row.lastAt = String(entry.ts || '');
        map.set(key, row);
      };
      addRow(bySessionMap, sessionId);
      addRow(byBrainMap, brainId);
    }
    return {
      generatedAt: new Date().toISOString(),
      windowDays: Number.isFinite(Number(options && options.days)) ? Number(options.days) : 7,
      totals,
      bySession: Array.from(bySessionMap.values()).sort((a, b) => b.totalTokens - a.totalTokens),
      byBrain: Array.from(byBrainMap.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    };
  }

  function listToolExecutions(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const limit = Number.isFinite(Number(opts.limit)) ? Math.min(500, Math.max(1, Number(opts.limit))) : 80;
    const entries = readAuditEntries({
      days: Number.isFinite(Number(opts.days)) ? opts.days : 7,
      limit: Math.max(limit * 4, 200),
    });
    return entries
      .filter((entry) => entry && entry.tool)
      .slice(0, limit)
      .map((entry) => ({
        ts: String(entry.ts || ''),
        clientId: String(entry.clientId || 'unknown'),
        sessionId: String(entry.sessionId || ''),
        brainId: String(entry.brainId || ''),
        tool: String(entry.tool || ''),
        ok: Boolean(entry.ok),
        errorCode: entry.errorCode ? String(entry.errorCode) : null,
        durationMs: Number.isFinite(Number(entry.durationMs)) ? Math.max(0, Math.round(Number(entry.durationMs))) : null,
        argsDigest: entry.argsDigest ? String(entry.argsDigest) : null,
        policyDecision: entry.policyDecision ? String(entry.policyDecision) : null,
        toolCallId: entry.toolCallId ? String(entry.toolCallId) : null,
        traceId: entry.traceId ? String(entry.traceId) : null,
        jsonRpcId: entry.jsonRpcId != null ? String(entry.jsonRpcId) : null,
        workflowPromotionPreflight:
          entry.workflowPromotionPreflight && typeof entry.workflowPromotionPreflight === 'object'
            ? {
                target: entry.workflowPromotionPreflight.target ? String(entry.workflowPromotionPreflight.target) : '',
                skillId: entry.workflowPromotionPreflight.skillId ? String(entry.workflowPromotionPreflight.skillId) : '',
                currentPhase: entry.workflowPromotionPreflight.currentPhase
                  ? String(entry.workflowPromotionPreflight.currentPhase)
                  : '',
                publishable: Boolean(entry.workflowPromotionPreflight.publishable),
                passedGates: Array.isArray(entry.workflowPromotionPreflight.passedGates)
                  ? entry.workflowPromotionPreflight.passedGates.map(String)
                  : [],
                missingGates: Array.isArray(entry.workflowPromotionPreflight.missingGates)
                  ? entry.workflowPromotionPreflight.missingGates.map(String)
                  : [],
                adminConfirmation:
                  entry.workflowPromotionPreflight.adminConfirmation &&
                  typeof entry.workflowPromotionPreflight.adminConfirmation === 'object'
                    ? {
                        required: Boolean(entry.workflowPromotionPreflight.adminConfirmation.required),
                        passed: Boolean(entry.workflowPromotionPreflight.adminConfirmation.passed),
                        sourceRequired: entry.workflowPromotionPreflight.adminConfirmation.sourceRequired
                          ? String(entry.workflowPromotionPreflight.adminConfirmation.sourceRequired)
                          : 'copilot_ui',
                        source: entry.workflowPromotionPreflight.adminConfirmation.source
                          ? String(entry.workflowPromotionPreflight.adminConfirmation.source)
                          : '',
                        autoConfirmCountsAsAdminApproval: Boolean(
                          entry.workflowPromotionPreflight.adminConfirmation.autoConfirmCountsAsAdminApproval,
                        ),
                      }
                    : null,
              }
            : undefined,
        usageGovernance:
          entry.usageGovernance && typeof entry.usageGovernance === 'object'
            ? {
                action: entry.usageGovernance.action ? String(entry.usageGovernance.action) : '',
                endpoint: entry.usageGovernance.endpoint ? String(entry.usageGovernance.endpoint) : '',
                partition: entry.usageGovernance.partition ? String(entry.usageGovernance.partition) : '',
                ok: Boolean(entry.usageGovernance.ok),
                code: entry.usageGovernance.code ? String(entry.usageGovernance.code) : '',
                authRequired: Boolean(entry.usageGovernance.authRequired),
                dryRun: Boolean(entry.usageGovernance.dryRun),
                uploaded: Boolean(entry.usageGovernance.uploaded),
                validated: Boolean(entry.usageGovernance.validated),
                noEvents: Boolean(entry.usageGovernance.noEvents),
                eventCount: Number.isFinite(Number(entry.usageGovernance.eventCount))
                  ? Math.max(0, Math.round(Number(entry.usageGovernance.eventCount)))
                  : 0,
                exitReady: Boolean(entry.usageGovernance.exitReady),
                clearedGates: Array.isArray(entry.usageGovernance.clearedGates)
                  ? entry.usageGovernance.clearedGates.map(String)
                  : [],
                remainingGates: Array.isArray(entry.usageGovernance.remainingGates)
                  ? entry.usageGovernance.remainingGates.map(String)
                  : [],
                quotaPolicy:
                  entry.usageGovernance.quotaPolicy && typeof entry.usageGovernance.quotaPolicy === 'object'
                    ? {
                        currentPhase: entry.usageGovernance.quotaPolicy.currentPhase
                          ? String(entry.usageGovernance.quotaPolicy.currentPhase)
                          : '',
                        billingSku: entry.usageGovernance.quotaPolicy.billingSku
                          ? String(entry.usageGovernance.quotaPolicy.billingSku)
                          : '',
                        cloudQuotaEnforced: Boolean(entry.usageGovernance.quotaPolicy.cloudQuotaEnforced),
                        usageBillingEnabled: Boolean(entry.usageGovernance.quotaPolicy.usageBillingEnabled),
                        enforcementSource: entry.usageGovernance.quotaPolicy.enforcementSource
                          ? String(entry.usageGovernance.quotaPolicy.enforcementSource)
                          : '',
                        policyId: entry.usageGovernance.quotaPolicy.policyId
                          ? String(entry.usageGovernance.quotaPolicy.policyId)
                          : '',
                      }
                    : null,
              }
            : undefined,
      }));
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
    clearMessages,
    writeContextSnapshot,
    appendAudit,
    readAuditEntries,
    summarizeUsageAudit,
    listToolExecutions,
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
