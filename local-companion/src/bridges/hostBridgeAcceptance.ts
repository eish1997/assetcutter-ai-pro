import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';

export type HostBridgeAcceptanceRecord = {
  id: string;
  ok: boolean;
  checkedAt: string;
  message: string;
  groups: string[];
};

export type HostBridgeAcceptanceGroupId =
  | 'maya'
  | 'adobe'
  | 'python_dcc'
  | 'lua_heartbeat'
  | 'project_plugin'
  | 'manual_script_dir'
  | 'paired_software';

export type HostBridgeAcceptanceGroup = {
  id: HostBridgeAcceptanceGroupId;
  label: string;
  hosts: string[];
};

export type HostBridgeAcceptanceSummary = {
  ok: boolean;
  acceptedGroups: number;
  requiredGroups: number;
  groups: Array<HostBridgeAcceptanceGroup & {
    ok: boolean;
    acceptedHosts: string[];
    missingHosts: string[];
  }>;
};

export const REQUIRED_HOST_BRIDGE_ACCEPTANCE_GROUPS: HostBridgeAcceptanceGroup[] = [
  { id: 'maya', label: 'Maya', hosts: ['maya'] },
  { id: 'adobe', label: 'Adobe', hosts: ['photoshop', 'illustrator', 'after-effects', 'premiere', 'indesign', 'audition', 'media-encoder', 'animate', 'adobe-bridge'] },
  { id: 'python_dcc', label: 'Python DCC', hosts: ['blender', '3ds-max', 'cinema-4d', 'houdini', 'nuke', 'motionbuilder', 'keyshot', 'modo', 'lightwave', 'substance-painter', 'substance-designer', 'mari', 'krita', 'gimp', 'rhino', 'sketchup', 'marmoset-toolbag', 'natron'] },
  { id: 'lua_heartbeat', label: 'Lua/heartbeat', hosts: ['darktable', 'lightroom-classic', 'obs-studio', 'reaper', 'aseprite', 'moho', 'rizomuv'] },
  { id: 'project_plugin', label: 'Project plugin', hosts: ['unity', 'unreal', 'godot', 'fusion-360', 'freecad'] },
  { id: 'manual_script_dir', label: 'Manual script directory', hosts: ['zbrush', '3dequalizer', 'katana', 'autocad', 'toon-boom-harmony', 'opentoonz', 'cavalry', 'tvpaint', 'vegas-pro', 'synfig', 'daz-studio', 'poser', 'metashape'] },
  { id: 'paired_software', label: 'Paired software', hosts: ['marvelous-designer', 'clo', 'iclone', 'character-creator', 'nuke-studio', 'hiero'] },
];

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function acceptancePath(): string {
  return join(bridgesStateDir(), 'host-bridge-acceptance.json');
}

export function readHostBridgeAcceptance(): Record<string, HostBridgeAcceptanceRecord> {
  const p = acceptancePath();
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, HostBridgeAcceptanceRecord>;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, HostBridgeAcceptanceRecord> = {};
    for (const [id, rec] of Object.entries(raw)) {
      if (!rec || typeof rec !== 'object') continue;
      out[id] = {
        id,
        ok: Boolean(rec.ok),
        checkedAt: typeof rec.checkedAt === 'string' ? rec.checkedAt : '',
        message: typeof rec.message === 'string' ? rec.message : '',
        groups: Array.isArray(rec.groups) ? rec.groups.map(String).filter(Boolean) : groupsForHost(id),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function groupsForHost(id: string): string[] {
  const key = String(id || '').trim();
  return REQUIRED_HOST_BRIDGE_ACCEPTANCE_GROUPS.filter((group) => group.hosts.includes(key)).map((group) => group.id);
}

export function buildHostBridgeAcceptanceSummary(
  acceptance: Record<string, HostBridgeAcceptanceRecord> = readHostBridgeAcceptance(),
): HostBridgeAcceptanceSummary {
  const groups = REQUIRED_HOST_BRIDGE_ACCEPTANCE_GROUPS.map((group) => {
    const acceptedHosts = group.hosts.filter((host) => Boolean(acceptance[host]?.ok));
    return {
      ...group,
      ok: acceptedHosts.length > 0,
      acceptedHosts,
      missingHosts: group.hosts.filter((host) => !acceptance[host]?.ok),
    };
  });
  const acceptedGroups = groups.filter((group) => group.ok).length;
  return {
    ok: acceptedGroups === REQUIRED_HOST_BRIDGE_ACCEPTANCE_GROUPS.length,
    acceptedGroups,
    requiredGroups: REQUIRED_HOST_BRIDGE_ACCEPTANCE_GROUPS.length,
    groups,
  };
}

export function writeHostBridgeAcceptanceRecord(
  id: string,
  result: { ok: boolean; message?: string },
): HostBridgeAcceptanceRecord {
  const key = String(id || '').trim();
  if (!key) throw new Error('host bridge id is required');
  const message = String(result.message || '').trim().slice(0, 500);
  if (result.ok && message.length < 12) {
    throw new Error('acceptance_evidence_required');
  }
  const groups = groupsForHost(key);
  if (result.ok && groups.length === 0) {
    throw new Error('acceptance_host_not_in_required_groups');
  }
  const next = readHostBridgeAcceptance();
  const rec: HostBridgeAcceptanceRecord = {
    id: key,
    ok: Boolean(result.ok),
    checkedAt: new Date().toISOString(),
    message,
    groups,
  };
  next[key] = rec;
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = acceptancePath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  renameSync(tmp, p);
  return rec;
}
