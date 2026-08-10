import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';
import { hostBridgeDefinitionToCatalogEntry, type HostBridgeDefinition } from './definitions/hostBridgeDefinitions.js';
import { readHostBridgeDraft, validateHostBridgeDraft, type HostBridgeDraft } from './hostBridgeDrafts.js';
import { getHostBridgeTemplate } from './templates/hostBridgeTemplates.js';

export type HostBridgeCloudVersion = {
  id: string;
  hostId: string;
  semver: string;
  note: string;
  publishedAt: string;
  publishedBy?: string;
  definition: HostBridgeDefinition;
};

export type HostBridgeCloudSyncResult =
  | { ok: true; synced: number; skipped: number }
  | { ok: false; error: string; message: string };

export type HostBridgeCloudStore = {
  version: 1;
  active: Record<string, string>;
  versions: Record<string, HostBridgeCloudVersion[]>;
  installs?: Record<string, HostBridgeCloudInstallRecord[]>;
};

export type HostBridgeCloudInstallRecord = {
  id: string;
  targetDir: string;
  generatedFiles: string[];
  heartbeatPath?: string;
  installedAt: string;
};

const CLOUD_PUBLISH_PROBE_MAX_AGE_MS = 30 * 60 * 1000;

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function cloudStorePath(): string {
  return join(bridgesStateDir(), 'host-cloud-versions.json');
}

function emptyStore(): HostBridgeCloudStore {
  return { version: 1, active: {}, versions: {}, installs: {} };
}

function readStore(): HostBridgeCloudStore {
  try {
    const p = cloudStorePath();
    if (!existsSync(p)) return emptyStore();
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as HostBridgeCloudStore;
    return parsed && parsed.version === 1 && parsed.versions ? { ...emptyStore(), ...parsed } : emptyStore();
  } catch {
    return emptyStore();
  }
}

function writeStore(store: HostBridgeCloudStore): void {
  const p = cloudStorePath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(tmp, p);
}

function normalizeSemver(raw: unknown, existingCount: number): string {
  const text = String(raw || '').trim();
  if (/^\d+\.\d+\.\d+$/.test(text)) return text;
  return `0.1.${Math.max(0, existingCount)}`;
}

function draftToDefinition(draft: HostBridgeDraft): HostBridgeDefinition {
  const { source: _source, draftStatus: _draftStatus, createdBy: _createdBy, createdAt: _createdAt, updatedAt: _updatedAt, validation: _validation, installs: _installs, lastProbe: _lastProbe, ...definition } = draft;
  return definition;
}

function normalizePort(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : fallback;
}

function parseTime(value: unknown): number {
  const n = Date.parse(String(value || ''));
  return Number.isFinite(n) ? n : 0;
}

function latestInstallTime(installs: HostBridgeDraft['installs']): number {
  return Math.max(0, ...(Array.isArray(installs) ? installs.map((item) => parseTime(item.installedAt)) : []));
}

function selectedTargetDir(input: { targetDir?: string; scriptsDir?: string; scriptsDirs?: string[] }): string {
  const raw = input.targetDir || input.scriptsDir || (Array.isArray(input.scriptsDirs) ? input.scriptsDirs[0] : '');
  const resolved = resolve(String(raw || '').trim());
  if (!resolved || resolved === resolve(resolved, '..')) throw new Error('target_dir_required');
  const lower = resolved.toLowerCase().replace(/\\/g, '/');
  const denied = ['c:/windows', 'c:/program files', 'c:/program files (x86)', 'c:/programdata'];
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

function assertSafeRelativePath(raw: unknown): boolean {
  const text = String(raw || '').trim().replace(/\\/g, '/');
  if (!text || text.startsWith('/') || /^[a-z]:\//i.test(text)) return false;
  return !text.split('/').filter(Boolean).includes('..');
}

function isValidPort(raw: unknown): boolean {
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 && port <= 65535;
}

function isSafeCloudDefinition(def: unknown): def is HostBridgeDefinition {
  if (!def || typeof def !== 'object') return false;
  const row = def as HostBridgeDefinition;
  if (!row.id || !row.name || !row.bridgeTemplate || !row.probe || !row.uninstall || !row.manualTarget) return false;
  if (!getHostBridgeTemplate(row.bridgeTemplate.id)) return false;
  if (!assertSafeRelativePath(row.bridgeTemplate.entryFile)) return false;
  if (!Array.isArray(row.manualTarget.accepts) || !row.manualTarget.accepts.length) return false;
  if (!isValidPort(row.defaultPort) || !isValidPort(row.probe.port)) return false;
  if (row.probe.kind === 'http' && row.probe.path !== '/health') return false;
  if (row.probe.kind === 'heartbeat' && !assertSafeRelativePath(row.probe.heartbeatFile)) return false;
  if (!['http', 'heartbeat', 'command_port'].includes(row.probe.kind)) return false;
  if (!Array.isArray(row.uninstall.generatedFiles) || !row.uninstall.generatedFiles.length) return false;
  return row.uninstall.generatedFiles.every(assertSafeRelativePath);
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

function heartbeatPathForDefinition(def: HostBridgeDefinition, targetDir: string): string | undefined {
  if (def.probe.kind !== 'heartbeat') return undefined;
  const fileName = def.probe.heartbeatFile || `${def.id}-heartbeat.json`;
  return join(targetDir, '.assetcutter', fileName);
}

export function listHostBridgeCloudVersions(hostId?: string): HostBridgeCloudVersion[] {
  const store = readStore();
  const all = hostId ? store.versions[hostId] || [] : Object.values(store.versions).flat();
  return all.slice().sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

export function activeHostBridgeCloudVersion(hostId: string): HostBridgeCloudVersion | null {
  const store = readStore();
  const activeId = store.active[hostId];
  const versions = store.versions[hostId] || [];
  return versions.find((item) => item.id === activeId) || versions[0] || null;
}

export function listHostBridgeCloudCatalogEntries() {
  const store = readStore();
  const entries = [];
  for (const hostId of Object.keys(store.versions)) {
    const version = activeHostBridgeCloudVersion(hostId);
    if (!version) continue;
    entries.push({
      ...hostBridgeDefinitionToCatalogEntry(version.definition),
      source: 'cloud' as const,
      cloudVersion: version.semver,
      cloudVersionId: version.id,
      cloudVersions: (store.versions[hostId] || []).map((item) => ({
        id: item.id,
        semver: item.semver,
        note: item.note,
        publishedAt: item.publishedAt,
        active: item.id === version.id,
      })),
    });
  }
  return entries;
}

export function syncHostBridgeCloudVersionsFromRemote(
  versions: HostBridgeCloudVersion[],
): HostBridgeCloudSyncResult {
  try {
    const incoming = Array.isArray(versions) ? versions : [];
    const store = readStore();
    store.versions = store.versions || {};
    store.active = store.active || {};
    let synced = 0;
    let skipped = 0;
    for (const version of incoming) {
      if (!version || !version.hostId || !version.id || !version.definition) continue;
      if (String(version.hostId) !== String(version.definition.id || '') || !isSafeCloudDefinition(version.definition)) {
        skipped += 1;
        continue;
      }
      const hostId = String(version.hostId);
      const existing = store.versions[hostId] || [];
      const next = [version]
        .concat(existing.filter((item) => item.id !== version.id))
        .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
      store.versions[hostId] = next;
      const activeFromRemote = Boolean((version as HostBridgeCloudVersion & { active?: boolean }).active);
      if (activeFromRemote || !store.active[hostId]) store.active[hostId] = version.id;
      synced += 1;
    }
    writeStore(store);
    return { ok: true, synced, skipped };
  } catch (e) {
    return { ok: false, error: 'cloud_sync_failed', message: e instanceof Error ? e.message : String(e) };
  }
}

export function publishHostBridgeDraftToCloud(
  hostId: string,
  input: { semver?: string; note?: string; publishedBy?: string } = {},
): { ok: true; version: HostBridgeCloudVersion } | { ok: false; error: string; message: string } {
  const draft = readHostBridgeDraft(hostId);
  if (!draft) return { ok: false, error: 'draft_not_found', message: '未找到本地宿主草稿。' };
  const validation = validateHostBridgeDraft(draft);
  if (!validation.ok) return { ok: false, error: 'draft_invalid', message: validation.messages.join('；') };
  const installs = Array.isArray(draft.installs) ? draft.installs : [];
  if (!installs.length) return { ok: false, error: 'acceptance_required', message: '请先安装并完成至少一次本地验收，再提交云端。' };
  if (!draft.lastProbe || draft.lastProbe.ok !== true) {
    return { ok: false, error: 'probe_required', message: '请先完成一次真实连接探测成功，再提交云端。' };
  }
  const probeTime = parseTime(draft.lastProbe.checkedAt);
  if (!probeTime || Date.now() - probeTime > CLOUD_PUBLISH_PROBE_MAX_AGE_MS) {
    return { ok: false, error: 'probe_stale', message: '最近一次真实连接探测已过期，请重新探测成功后再提交云端。' };
  }
  if (probeTime < latestInstallTime(installs)) {
    return { ok: false, error: 'probe_before_latest_install', message: '最近一次安装后还没有探测成功，请重新探测后再提交云端。' };
  }
  const note = String(input.note || '').trim();
  if (!note) return { ok: false, error: 'version_note_required', message: '版本说明不能为空。' };

  const store = readStore();
  const versions = store.versions[draft.id] || [];
  const semver = normalizeSemver(input.semver, versions.length);
  const now = new Date().toISOString();
  const version: HostBridgeCloudVersion = {
    id: `${draft.id}@${semver}@${Date.now()}`,
    hostId: draft.id,
    semver,
    note,
    publishedAt: now,
    publishedBy: input.publishedBy,
    definition: draftToDefinition(draft),
  };
  store.versions[draft.id] = [version].concat(versions);
  store.active[draft.id] = version.id;
  writeStore(store);
  return { ok: true, version };
}

export function switchHostBridgeCloudVersion(
  hostId: string,
  versionId: string,
): { ok: true; version: HostBridgeCloudVersion } | { ok: false; error: string; message: string } {
  const store = readStore();
  const version = (store.versions[hostId] || []).find((item) => item.id === versionId);
  if (!version) return { ok: false, error: 'cloud_version_not_found', message: '只能切换云端已有版本。' };
  store.active[hostId] = version.id;
  writeStore(store);
  return { ok: true, version };
}

export function installHostBridgeCloud(
  hostId: string,
  input: { targetDir?: string; scriptsDir?: string; scriptsDirs?: string[]; port?: number } = {},
): { ok: true; targetDir: string; generatedFiles: string[]; heartbeatPath?: string } | { ok: false; error: string; message: string } {
  try {
    const version = activeHostBridgeCloudVersion(hostId);
    if (!version) return { ok: false, error: 'cloud_host_not_found', message: '未找到云端宿主版本。' };
    const def = version.definition;
    const template = getHostBridgeTemplate(def.bridgeTemplate.id);
    if (!template) return { ok: false, error: 'template_not_found', message: `桥接模板不存在：${def.bridgeTemplate.id}` };
    const targetDir = selectedTargetDir(input);
    mkdirSync(targetDir, { recursive: true });
    const port = normalizePort(input.port, def.defaultPort);
    const heartbeatPath = heartbeatPathForDefinition(def, targetDir);
    const files = template.generateInstallFiles({
      hostId: def.id,
      hostName: def.name,
      port,
      entryFile: def.bridgeTemplate.entryFile,
      heartbeatFile: heartbeatPath,
    });
    const generatedFiles: string[] = [];
    for (const file of files) {
      const fullPath = assertInsideTarget(targetDir, join(targetDir, file.relativePath));
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, file.contents, file.encoding);
      generatedFiles.push(file.relativePath);
    }
    const store = readStore();
    store.installs = store.installs || {};
    const record: HostBridgeCloudInstallRecord = {
      id: `cloud-install::${def.id}::${Date.now()}`,
      targetDir,
      generatedFiles,
      heartbeatPath,
      installedAt: new Date().toISOString(),
    };
    store.installs[def.id] = [record].concat((store.installs[def.id] || []).filter((item) => item.targetDir !== targetDir)).slice(0, 20);
    writeStore(store);
    return { ok: true, targetDir, generatedFiles, heartbeatPath };
  } catch (e) {
    return { ok: false, error: 'cloud_install_failed', message: userMessageForInstallError(e) };
  }
}

export async function probeHostBridgeCloud(
  hostId: string,
): Promise<{ ok: true; connected: boolean; message: string } | { ok: false; error: string; message: string }> {
  const version = activeHostBridgeCloudVersion(hostId);
  if (!version) return { ok: false, error: 'cloud_host_not_found', message: '未找到云端宿主版本。' };
  const template = getHostBridgeTemplate(version.definition.bridgeTemplate.id);
  if (!template) return { ok: false, error: 'template_not_found', message: `桥接模板不存在：${version.definition.bridgeTemplate.id}` };
  const store = readStore();
  const latest = (store.installs?.[hostId] || [])[0];
  const result = await template.probe({
    hostId,
    port: version.definition.defaultPort,
    heartbeatPath: latest?.heartbeatPath,
  });
  return { ok: true, connected: result.ok, message: result.message };
}

export function uninstallHostBridgeCloud(
  hostId: string,
): { ok: true; removed: string[] } | { ok: false; error: string; message: string } {
  try {
    const version = activeHostBridgeCloudVersion(hostId);
    if (!version) return { ok: false, error: 'cloud_host_not_found', message: '未找到云端宿主版本。' };
    const template = getHostBridgeTemplate(version.definition.bridgeTemplate.id);
    if (!template) return { ok: false, error: 'template_not_found', message: `桥接模板不存在：${version.definition.bridgeTemplate.id}` };
    const store = readStore();
    const installs = store.installs?.[hostId] || [];
    const removed: string[] = [];
    for (const install of installs) {
      const plan = template.uninstall({ generatedFiles: install.generatedFiles });
      for (const rel of plan.generatedFiles) {
        const fullPath = assertInsideTarget(install.targetDir, join(install.targetDir, rel));
        if (existsSync(fullPath) && statSync(fullPath).isFile()) {
          rmSync(fullPath, { force: true });
          removed.push(fullPath);
        }
      }
    }
    store.installs = store.installs || {};
    store.installs[hostId] = [];
    writeStore(store);
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, error: 'cloud_uninstall_failed', message: userMessageForInstallError(e) };
  }
}
