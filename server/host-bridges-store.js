import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DATA_PATH = path.resolve(process.cwd(), 'server', 'data', 'host-bridges.json');
const ALLOWED_TEMPLATE_IDS = new Set([
  'python_http_startup',
  'lua_heartbeat',
  'extendscript_heartbeat',
  'project_plugin',
  'manual_script_dir',
  'maya_command_port',
]);
const ALLOWED_PROBE_KINDS = new Set(['http', 'heartbeat', 'command_port']);

function defaultData() {
  return { schemaVersion: 1, active: {}, versions: {} };
}

async function readRaw() {
  try {
    const text = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return defaultData();
    return {
      ...defaultData(),
      ...parsed,
      active: parsed.active && typeof parsed.active === 'object' ? parsed.active : {},
      versions: parsed.versions && typeof parsed.versions === 'object' ? parsed.versions : {},
    };
  } catch {
    return defaultData();
  }
}

async function writeRaw(data) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function normalizeHostId(raw) {
  const id = String(raw || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) throw new Error('host_id_invalid');
  return id;
}

function normalizeSemver(raw, existingCount) {
  const text = String(raw || '').trim();
  if (/^\d+\.\d+\.\d+$/.test(text)) return text;
  return `0.1.${Math.max(0, Number(existingCount) || 0)}`;
}

function assertSafeRelativePath(raw, errorCode) {
  const text = String(raw || '').trim().replace(/\\/g, '/');
  if (!text) throw new Error(errorCode);
  if (text.startsWith('/') || /^[a-z]:\//i.test(text)) throw new Error(errorCode);
  const parts = text.split('/').filter(Boolean);
  if (parts.includes('..')) throw new Error(errorCode);
  return text;
}

function assertPort(raw, errorCode) {
  const port = Number(raw);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(errorCode);
  return Math.floor(port);
}

function assertProbe(probe) {
  if (!probe || typeof probe !== 'object') throw new Error('definition_probe_required');
  const kind = String(probe.kind || '').trim();
  if (!ALLOWED_PROBE_KINDS.has(kind)) throw new Error('definition_probe_invalid');
  assertPort(probe.port, 'definition_probe_port_invalid');
  if (kind === 'http' && probe.path !== '/health') throw new Error('definition_probe_http_path_invalid');
  if (kind === 'heartbeat') assertSafeRelativePath(probe.heartbeatFile, 'definition_probe_heartbeat_file_invalid');
}

function assertDefinition(def) {
  if (!def || typeof def !== 'object') throw new Error('definition_required');
  normalizeHostId(def.id);
  if (!String(def.name || '').trim()) throw new Error('definition_name_required');
  if (!['3d', 'engine', 'paint', 'post', 'compositing'].includes(def.category)) throw new Error('definition_category_invalid');
  assertPort(def.defaultPort, 'definition_port_invalid');
  if (!def.bridgeTemplate || typeof def.bridgeTemplate !== 'object') throw new Error('definition_template_required');
  if (!ALLOWED_TEMPLATE_IDS.has(String(def.bridgeTemplate.id || '').trim())) throw new Error('definition_template_invalid');
  assertSafeRelativePath(def.bridgeTemplate.entryFile, 'definition_entry_file_invalid');
  if (!def.manualTarget || typeof def.manualTarget !== 'object') throw new Error('definition_manual_target_required');
  if (!Array.isArray(def.manualTarget.accepts) || !def.manualTarget.accepts.length) throw new Error('definition_manual_target_required');
  assertProbe(def.probe);
  if (!def.uninstall || typeof def.uninstall !== 'object') throw new Error('definition_uninstall_required');
  if (!Array.isArray(def.uninstall.generatedFiles) || !def.uninstall.generatedFiles.length) {
    throw new Error('definition_uninstall_generated_files_required');
  }
  for (const file of def.uninstall.generatedFiles) {
    assertSafeRelativePath(file, 'definition_uninstall_generated_file_invalid');
  }
}

function makeVersionId(hostId, semver) {
  return `${hostId}@${semver}@${crypto.randomBytes(6).toString('hex')}`;
}

export async function listHostBridgeDefinitions() {
  const data = await readRaw();
  const out = [];
  for (const hostId of Object.keys(data.versions || {})) {
    const versions = Array.isArray(data.versions[hostId]) ? data.versions[hostId] : [];
    const activeId = data.active[hostId];
    const active = versions.find((item) => item.id === activeId) || versions[0] || null;
    if (!active) continue;
    out.push({
      ...active,
      active: true,
      versions: versions.map((item) => ({
        id: item.id,
        hostId: item.hostId,
        semver: item.semver,
        note: item.note,
        publishedAt: item.publishedAt,
        publishedBy: item.publishedBy,
        active: item.id === active.id,
      })),
    });
  }
  return out.sort((a, b) => String(a.definition?.name || a.hostId).localeCompare(String(b.definition?.name || b.hostId)));
}

export async function listHostBridgeVersions(hostIdRaw) {
  const hostId = normalizeHostId(hostIdRaw);
  const data = await readRaw();
  const activeId = data.active[hostId];
  return (Array.isArray(data.versions[hostId]) ? data.versions[hostId] : []).map((item) => ({
    ...item,
    active: item.id === activeId,
  }));
}

export async function addHostBridgeVersion(input) {
  const definition = input && input.definition;
  assertDefinition(definition);
  const hostId = normalizeHostId(definition.id);
  const data = await readRaw();
  const versions = Array.isArray(data.versions[hostId]) ? data.versions[hostId] : [];
  const semver = normalizeSemver(input.semver, versions.length);
  const note = String(input.note || '').trim();
  if (!note) throw new Error('version_note_required');
  const version = {
    id: makeVersionId(hostId, semver),
    hostId,
    semver,
    note,
    publishedAt: new Date().toISOString(),
    publishedBy: String(input.publishedBy || '').trim(),
    definition,
  };
  data.versions[hostId] = [version].concat(versions);
  data.active[hostId] = version.id;
  await writeRaw(data);
  return version;
}

export async function activateHostBridgeVersion(hostIdRaw, versionIdRaw) {
  const hostId = normalizeHostId(hostIdRaw);
  const versionId = String(versionIdRaw || '').trim();
  const data = await readRaw();
  const version = (Array.isArray(data.versions[hostId]) ? data.versions[hostId] : []).find((item) => item.id === versionId);
  if (!version) throw new Error('cloud_version_not_found');
  data.active[hostId] = version.id;
  await writeRaw(data);
  return version;
}
