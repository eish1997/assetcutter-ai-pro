import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';
import {
  hostBridgeDefinitionToCatalogEntry,
  type HostBridgeCategory,
  type HostBridgeDefinition,
  type HostDetectionRule,
} from './definitions/hostBridgeDefinitions.js';
import { getHostBridgeTemplate, type BridgeTemplateId } from './templates/hostBridgeTemplates.js';

export type HostBridgeDraftStatus = 'created' | 'validated' | 'failed';

export type HostBridgeDraft = HostBridgeDefinition & {
  source: 'copilot';
  draftStatus: HostBridgeDraftStatus;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  validation?: {
    ok: boolean;
    messages: string[];
  };
  installs?: HostBridgeDraftInstallRecord[];
  lastProbe?: {
    ok: boolean;
    message: string;
    checkedAt: string;
  };
};

export type HostBridgeDraftInput = {
  id?: string;
  name: string;
  category?: HostBridgeCategory;
  defaultPort?: number;
  connectorLabel?: string;
  templateId?: BridgeTemplateId;
  entryFile?: string;
  tags?: string[];
  description?: string;
  createdBy?: string;
};

export type HostBridgeDraftInstallRecord = {
  id: string;
  targetDir: string;
  generatedFiles: string[];
  heartbeatPath?: string;
  installedAt: string;
};

export type HostBridgeDraftInstallInput = {
  targetDir?: string;
  scriptsDir?: string;
  scriptsDirs?: string[];
  port?: number;
};

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function draftsDir(): string {
  return join(bridgesStateDir(), 'host-drafts');
}

function slugifyHostId(raw: string): string {
  const base = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(base)) throw new Error('invalid_host_id');
  return base;
}

function draftPath(id: string): string {
  return join(draftsDir(), `${slugifyHostId(id)}.json`);
}

function writeDraft(draft: HostBridgeDraft): void {
  mkdirSync(draftsDir(), { recursive: true });
  const p = draftPath(draft.id);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  renameSync(tmp, p);
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : 7701;
}

function inferTemplate(input: HostBridgeDraftInput): BridgeTemplateId {
  if (input.templateId) return input.templateId;
  const text = `${input.name} ${input.connectorLabel || ''} ${(input.tags || []).join(' ')}`.toLowerCase();
  if (/extendscript|adobe|photoshop|illustrator|premiere|after effects/.test(text)) return 'extendscript_heartbeat';
  if (/\blua\b|aseprite|darktable|reaper|obs/.test(text)) return 'lua_heartbeat';
  if (/project|plugin|unity|unreal|godot|engine/.test(text)) return 'project_plugin';
  if (/manual|script dir|script folder|zbrush|fusion studio|3dequalizer|3de|matchmove/.test(text)) return 'manual_script_dir';
  return 'python_http_startup';
}

function defaultEntryFile(id: string, templateId: BridgeTemplateId): string {
  if (templateId === 'extendscript_heartbeat') return `assetcutter_${id.replace(/-/g, '_')}_bridge.jsx`;
  if (templateId === 'lua_heartbeat') return `assetcutter_${id.replace(/-/g, '_')}_bridge.lua`;
  if (templateId === 'project_plugin') return `assetcutter_${id.replace(/-/g, '_')}_bridge`;
  if (templateId === 'manual_script_dir') return `assetcutter_${id.replace(/-/g, '_')}_bridge.py`;
  return `assetcutter_${id.replace(/-/g, '_')}_bridge.py`;
}

function defaultConnector(templateId: BridgeTemplateId): string {
  if (templateId === 'extendscript_heartbeat') return 'ExtendScript / heartbeat';
  if (templateId === 'lua_heartbeat') return 'Lua script / heartbeat';
  if (templateId === 'project_plugin') return 'Project plugin / local HTTP';
  if (templateId === 'manual_script_dir') return 'Manual script directory / heartbeat';
  return 'Python startup / local HTTP';
}

function defaultDetection(): HostDetectionRule[] {
  return [{ kind: 'manual_target' }];
}

export function readHostBridgeDrafts(): HostBridgeDraft[] {
  let names: string[] = [];
  try {
    names = readdirSync(draftsDir()).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const out: HostBridgeDraft[] = [];
  for (const name of names) {
    try {
      const raw = JSON.parse(readFileSync(join(draftsDir(), name), 'utf8')) as HostBridgeDraft;
      if (raw?.id && raw?.source === 'copilot') out.push(raw);
    } catch {
      /* ignore broken draft */
    }
  }
  return out.sort((a, b) => a.ui.priority - b.ui.priority || a.name.localeCompare(b.name));
}

export function readHostBridgeDraft(idRaw: string): HostBridgeDraft | null {
  try {
    const id = slugifyHostId(idRaw);
    const p = draftPath(id);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, 'utf8')) as HostBridgeDraft;
    return raw?.id === id && raw?.source === 'copilot' ? raw : null;
  } catch {
    return null;
  }
}

export function validateHostBridgeDraft(
  draft: HostBridgeDraft,
  existingIds: string[] = [],
): { ok: boolean; messages: string[] } {
  const messages: string[] = [];
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(draft.id)) messages.push('宿主 id 必须为小写字母开头，仅包含小写字母、数字和短横线。');
  if (existingIds.includes(draft.id)) messages.push(`宿主 id 已存在：${draft.id}`);
  if (!draft.name.trim()) messages.push('宿主名称不能为空。');
  if (!['3d', 'engine', 'paint', 'post', 'compositing'].includes(draft.category)) messages.push('宿主分类不合法。');
  if (draft.defaultPort < 1 || draft.defaultPort > 65535) messages.push('默认端口必须在 1 到 65535 之间。');
  if (!getHostBridgeTemplate(draft.bridgeTemplate.id)) messages.push(`桥接模板不存在：${draft.bridgeTemplate.id}`);
  if (!draft.bridgeTemplate.entryFile || draft.bridgeTemplate.entryFile.includes('..')) messages.push('桥接入口文件不合法。');
  if (!draft.manualTarget.accepts.length) messages.push('必须声明手动添加版本可接受的目录类型。');
  if (!draft.probe) messages.push('必须声明真实连接探测方式。');
  if (!draft.uninstall.generatedFiles.length) messages.push('必须声明卸载时处理的生成文件。');
  return { ok: messages.length === 0, messages };
}

export function createHostBridgeDraft(
  input: HostBridgeDraftInput,
  existingIds: string[] = [],
): { ok: true; draft: HostBridgeDraft } | { ok: false; error: string; messages: string[] } {
  const id = slugifyHostId(input.id || input.name);
  const templateId = inferTemplate(input);
  const template = getHostBridgeTemplate(templateId);
  if (!template) return { ok: false, error: 'template_not_found', messages: [`桥接模板不存在：${templateId}`] };
  const now = new Date().toISOString();
  const entryFile = input.entryFile || defaultEntryFile(id, templateId);
  const draft: HostBridgeDraft = {
    id,
    name: String(input.name || id).trim(),
    category: input.category || '3d',
    defaultPort: normalizePort(input.defaultPort),
    connectorLabel: input.connectorLabel || defaultConnector(templateId),
    installMode: 'one_click',
    status: 'ready',
    detection: defaultDetection(),
    manualTarget: {
      accepts: templateId === 'project_plugin' ? ['project_dir'] : templateId === 'manual_script_dir' ? ['script_dir', 'plugin_dir'] : ['script_dir'],
      resolver: templateId === 'project_plugin' ? 'manualProjectPluginDir' : 'manualScriptDir',
      pickerTitle: `选择 ${String(input.name || id).trim()} 脚本目录`,
    },
    bridgeTemplate: { id: templateId, entryFile },
    probe:
      templateId === 'python_http_startup' || templateId === 'project_plugin'
        ? { kind: 'http', port: normalizePort(input.defaultPort), path: '/health' }
        : { kind: 'heartbeat', port: normalizePort(input.defaultPort), heartbeatFile: `${id}-heartbeat.json` },
    uninstall: {
      mode: 'recorded_targets_and_markers',
      generatedFiles: [entryFile],
    },
    ui: {
      tags: input.tags?.length ? input.tags : ['本地草稿'],
      description: input.description || `${String(input.name || id).trim()} 本地宿主草稿，等待安装探测验收。`,
      actions: ['One-click install', 'Probe connection', 'Choose scripts folder', 'Delete draft'],
      restartHint: `重启 ${String(input.name || id).trim()} 后再探测连接。`,
      priority: 10000,
    },
    source: 'copilot',
    draftStatus: 'created',
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  const validation = validateHostBridgeDraft(draft, existingIds);
  draft.validation = validation;
  draft.draftStatus = validation.ok ? 'validated' : 'failed';
  if (!validation.ok) return { ok: false, error: 'draft_invalid', messages: validation.messages };
  writeDraft(draft);
  return { ok: true, draft };
}

export function deleteHostBridgeDraft(idRaw: string): boolean {
  const id = slugifyHostId(idRaw);
  const p = draftPath(id);
  if (!existsSync(p)) return false;
  rmSync(p, { force: true });
  return true;
}

function selectedTargetDir(input: HostBridgeDraftInstallInput): string {
  const raw = input.targetDir || input.scriptsDir || (Array.isArray(input.scriptsDirs) ? input.scriptsDirs[0] : '');
  const resolved = resolve(String(raw || '').trim());
  if (!resolved || resolved === resolve(resolved, '..')) throw new Error('target_dir_required');
  const lower = resolved.toLowerCase().replace(/\\/g, '/');
  const denied = [
    'c:/windows',
    'c:/program files',
    'c:/program files (x86)',
    'c:/programdata',
  ];
  if (denied.some((dir) => lower === dir || lower.startsWith(`${dir}/`))) throw new Error('target_dir_not_allowed');
  return resolved;
}

function userMessageForInstallError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'target_dir_required') return '请选择要安装桥接脚本的目录。';
  if (message === 'target_dir_not_allowed') return '不能直接安装到系统或软件安装目录，请选择该宿主的用户脚本目录、插件目录或项目目录。';
  if (message === 'generated_file_outside_target') return '桥接文件路径越界，已停止安装以保护本机文件。';
  return message;
}

function assertInsideTarget(targetDir: string, filePath: string): string {
  const target = resolve(targetDir);
  const resolved = resolve(filePath);
  const rel = relative(target, resolved);
  if (rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../') || resolve(rel) === rel) {
    throw new Error('generated_file_outside_target');
  }
  return resolved;
}

function heartbeatPathForDraft(draft: HostBridgeDraft, targetDir: string): string | undefined {
  if (draft.probe.kind !== 'heartbeat') return undefined;
  const fileName = draft.probe.heartbeatFile || `${draft.id}-heartbeat.json`;
  return join(targetDir, '.assetcutter', fileName);
}

export function installHostBridgeDraft(
  idRaw: string,
  input: HostBridgeDraftInstallInput = {},
): { ok: true; draft: HostBridgeDraft; targetDir: string; generatedFiles: string[]; heartbeatPath?: string } | { ok: false; error: string; message: string } {
  try {
    const draft = readHostBridgeDraft(idRaw);
    if (!draft) return { ok: false, error: 'draft_not_found', message: '未找到本地宿主草稿。' };
    const validation = validateHostBridgeDraft(draft);
    if (!validation.ok) return { ok: false, error: 'draft_invalid', message: validation.messages.join('；') };
    const template = getHostBridgeTemplate(draft.bridgeTemplate.id);
    if (!template) return { ok: false, error: 'template_not_found', message: `桥接模板不存在：${draft.bridgeTemplate.id}` };
    const targetDir = selectedTargetDir(input);
    mkdirSync(targetDir, { recursive: true });
    const port = normalizePort(input.port || draft.defaultPort);
    const heartbeatPath = heartbeatPathForDraft(draft, targetDir);
    const files = template.generateInstallFiles({
      hostId: draft.id,
      hostName: draft.name,
      port,
      entryFile: draft.bridgeTemplate.entryFile,
      heartbeatFile: heartbeatPath,
    });
    const generatedFiles: string[] = [];
    for (const file of files) {
      const fullPath = assertInsideTarget(targetDir, join(targetDir, file.relativePath));
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, file.contents, file.encoding);
      generatedFiles.push(file.relativePath);
    }
    const record: HostBridgeDraftInstallRecord = {
      id: `draft-install::${draft.id}::${Date.now()}`,
      targetDir,
      generatedFiles,
      heartbeatPath,
      installedAt: new Date().toISOString(),
    };
    draft.installs = [record].concat((draft.installs || []).filter((item) => item.targetDir !== targetDir)).slice(0, 20);
    draft.updatedAt = new Date().toISOString();
    writeDraft(draft);
    return { ok: true, draft, targetDir, generatedFiles, heartbeatPath };
  } catch (e) {
    return { ok: false, error: 'draft_install_failed', message: userMessageForInstallError(e) };
  }
}

export async function probeHostBridgeDraft(
  idRaw: string,
): Promise<{ ok: true; connected: boolean; message: string } | { ok: false; error: string; message: string }> {
  const draft = readHostBridgeDraft(idRaw);
  if (!draft) return { ok: false, error: 'draft_not_found', message: '未找到本地宿主草稿。' };
  const template = getHostBridgeTemplate(draft.bridgeTemplate.id);
  if (!template) return { ok: false, error: 'template_not_found', message: `桥接模板不存在：${draft.bridgeTemplate.id}` };
  const latest = (draft.installs || [])[0];
  const result = await template.probe({
    hostId: draft.id,
    port: draft.defaultPort,
    heartbeatPath: latest?.heartbeatPath,
  });
  draft.lastProbe = { ok: result.ok, message: result.message, checkedAt: new Date().toISOString() };
  if (result.ok) {
    draft.draftStatus = 'validated';
    draft.validation = { ok: true, messages: ['真实连接探测成功。'] };
  }
  draft.updatedAt = new Date().toISOString();
  writeDraft(draft);
  return { ok: true, connected: result.ok, message: result.message };
}

export function uninstallHostBridgeDraft(
  idRaw: string,
): { ok: true; removed: string[] } | { ok: false; error: string; message: string } {
  try {
    const draft = readHostBridgeDraft(idRaw);
    if (!draft) return { ok: false, error: 'draft_not_found', message: '未找到本地宿主草稿。' };
    const template = getHostBridgeTemplate(draft.bridgeTemplate.id);
    if (!template) return { ok: false, error: 'template_not_found', message: `桥接模板不存在：${draft.bridgeTemplate.id}` };
    const removed: string[] = [];
    for (const install of draft.installs || []) {
      const plan = template.uninstall({ generatedFiles: install.generatedFiles });
      for (const rel of plan.generatedFiles) {
        const fullPath = assertInsideTarget(install.targetDir, join(install.targetDir, rel));
        if (existsSync(fullPath)) {
          rmSync(fullPath, { force: true });
          removed.push(fullPath);
        }
      }
    }
    draft.installs = [];
    draft.updatedAt = new Date().toISOString();
    writeDraft(draft);
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, error: 'draft_uninstall_failed', message: userMessageForInstallError(e) };
  }
}

export function hostBridgeDraftToCatalogEntry(draft: HostBridgeDraft) {
  return {
    ...hostBridgeDefinitionToCatalogEntry(draft),
    source: 'draft' as const,
    draftStatus: draft.draftStatus,
    validation: draft.validation || null,
  };
}
