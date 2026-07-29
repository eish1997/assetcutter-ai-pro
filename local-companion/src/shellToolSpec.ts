/**
 * Shell tool package contract (ToolSpec v1 + PanelSpec v1).
 * @see docs/本地伴侣-小工具架开发规格.md
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

export const SHELL_TOOL_PERMISSIONS = ['path.pick', 'tool.run', 'host.open'] as const;
export type ShellToolPermissionV1 = (typeof SHELL_TOOL_PERMISSIONS)[number];

export const PANEL_FIELD_TYPES = ['path', 'select', 'text', 'toggle'] as const;
export type PanelFieldTypeV1 = (typeof PANEL_FIELD_TYPES)[number];

export const PANEL_ACTION_KINDS = ['run', 'openPath', 'open_in_host'] as const;
export type PanelActionKindV1 = (typeof PANEL_ACTION_KINDS)[number];

export const SHELL_TOOL_HOSTS = ['maya'] as const;
export type ShellToolHostV1 = (typeof SHELL_TOOL_HOSTS)[number];

export const PANEL_OUTPUT_TYPES = ['log'] as const;
export type PanelOutputTypeV1 = (typeof PANEL_OUTPUT_TYPES)[number];

export type ShellToolRunSpecV1 = {
  command: string[];
  cwd?: string;
  paramsMode: 'env';
  timeoutMs?: number;
};

export type ShellToolLaunchSpecV1 = {
  kind: 'shell_module';
  module: string;
};

/** Maya-in-process UI entry (Command Port inject). */
export type ShellToolMayaSpecV1 = {
  entryModule: string;
  entryFunc: string;
  /** Relative dirs under package root added to sys.path (default ["."]). */
  pythonPath?: string[];
};

export type ShellToolSpecV1 = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  semver: string;
  icon?: string;
  launch: ShellToolLaunchSpecV1;
  run?: ShellToolRunSpecV1;
  maya?: ShellToolMayaSpecV1;
  permissions: ShellToolPermissionV1[];
  tags?: string[];
  minCompanionSemver?: string;
  requires?: { localEngines?: string[] };
};

export type PanelPathFieldV1 = {
  type: 'path';
  id: string;
  label: string;
  pick: 'directory' | 'file';
  required?: boolean;
};

export type PanelSelectFieldV1 = {
  type: 'select';
  id: string;
  label: string;
  options: { value: string; label: string }[];
  default?: string;
  required?: boolean;
};

export type PanelTextFieldV1 = {
  type: 'text';
  id: string;
  label: string;
  default?: string;
  required?: boolean;
};

export type PanelToggleFieldV1 = {
  type: 'toggle';
  id: string;
  label: string;
  default?: boolean;
  required?: boolean;
};

export type PanelFieldV1 = PanelPathFieldV1 | PanelSelectFieldV1 | PanelTextFieldV1 | PanelToggleFieldV1;

export type PanelActionV1 = {
  id: string;
  label: string;
  kind: PanelActionKindV1;
  /** Required when kind is open_in_host (first host: maya). */
  host?: ShellToolHostV1;
  style?: 'primary' | 'default';
};

export type PanelOutputV1 = {
  type: 'log';
  id: string;
  label: string;
};

export type ShellToolPanelSpecV1 = {
  schemaVersion: 1;
  title: string;
  sections: { id: string; title?: string; fields: PanelFieldV1[] }[];
  actions: PanelActionV1[];
  outputs: PanelOutputV1[];
};

function isNonEmptyStringArray(a: unknown): a is string[] {
  return Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'string' && x.length > 0);
}

function isIdentifier(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id);
}

function parsePermissions(raw: unknown): ShellToolPermissionV1[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ShellToolPermissionV1[] = [];
  for (const p of raw) {
    if (typeof p !== 'string' || !(SHELL_TOOL_PERMISSIONS as readonly string[]).includes(p)) return null;
    if (!out.includes(p as ShellToolPermissionV1)) out.push(p as ShellToolPermissionV1);
  }
  return out.length > 0 ? out : null;
}

function parseRun(raw: unknown): ShellToolRunSpecV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isNonEmptyStringArray(o.command)) return null;
  const paramsMode = o.paramsMode === undefined ? 'env' : o.paramsMode;
  if (paramsMode !== 'env') return null;
  const out: ShellToolRunSpecV1 = { command: [...o.command], paramsMode: 'env' };
  if (typeof o.cwd === 'string' && o.cwd.trim()) out.cwd = o.cwd.trim();
  if (o.timeoutMs !== undefined) {
    const n = Number(o.timeoutMs);
    if (!Number.isFinite(n) || n < 1000 || n > 3_600_000) return null;
    out.timeoutMs = Math.floor(n);
  }
  return out;
}

function isMayaModuleName(s: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(s);
}

function parseMaya(raw: unknown): ShellToolMayaSpecV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.entryModule !== 'string' || !isMayaModuleName(o.entryModule.trim())) return null;
  if (typeof o.entryFunc !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(o.entryFunc.trim())) return null;
  const out: ShellToolMayaSpecV1 = {
    entryModule: o.entryModule.trim(),
    entryFunc: o.entryFunc.trim(),
  };
  if (o.pythonPath !== undefined) {
    if (!Array.isArray(o.pythonPath) || o.pythonPath.length === 0) return null;
    const paths: string[] = [];
    for (const p of o.pythonPath) {
      if (typeof p !== 'string' || !p.trim() || p.includes('..')) return null;
      paths.push(p.trim().replace(/\\/g, '/'));
    }
    out.pythonPath = paths;
  }
  return out;
}

function parseField(raw: unknown): PanelFieldV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (!isIdentifier(o.id) || typeof o.label !== 'string' || !o.label.trim()) return null;
  const base = { id: o.id, label: o.label.trim(), required: o.required === true };

  if (type === 'path') {
    if (o.pick !== 'directory' && o.pick !== 'file') return null;
    return { ...base, type: 'path', pick: o.pick };
  }
  if (type === 'select') {
    if (!Array.isArray(o.options) || o.options.length === 0) return null;
    const options: { value: string; label: string }[] = [];
    for (const opt of o.options) {
      if (!opt || typeof opt !== 'object') return null;
      const rec = opt as Record<string, unknown>;
      if (typeof rec.value !== 'string' || !rec.value || typeof rec.label !== 'string' || !rec.label.trim()) {
        return null;
      }
      options.push({ value: rec.value, label: rec.label.trim() });
    }
    const field: PanelSelectFieldV1 = { ...base, type: 'select', options };
    if (typeof o.default === 'string') field.default = o.default;
    return field;
  }
  if (type === 'text') {
    const field: PanelTextFieldV1 = { ...base, type: 'text' };
    if (typeof o.default === 'string') field.default = o.default;
    return field;
  }
  if (type === 'toggle') {
    const field: PanelToggleFieldV1 = { ...base, type: 'toggle' };
    if (typeof o.default === 'boolean') field.default = o.default;
    return field;
  }
  return null;
}

/** camelCase / mixed → TOOL_PARAM_UPPER_SNAKE */
export function shellToolParamToEnvKey(paramId: string): string {
  const snake = paramId
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
  return `TOOL_PARAM_${snake || 'VALUE'}`;
}

export function buildShellToolParamEnv(params: Record<string, string | boolean>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    env[shellToolParamToEnvKey(key)] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  }
  return env;
}

export function parseShellToolSpecJson(raw: unknown): ShellToolSpecV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) return null;
  if (typeof o.id !== 'string' || !TOOL_ID_PATTERN.test(o.id)) return null;
  if (typeof o.name !== 'string' || !o.name.trim()) return null;
  if (typeof o.description !== 'string' || !o.description.trim()) return null;
  if (typeof o.semver !== 'string' || !o.semver.trim()) return null;

  const permissions = parsePermissions(o.permissions);
  if (!permissions) return null;

  if (!o.launch || typeof o.launch !== 'object') return null;
  const launch = o.launch as Record<string, unknown>;
  if (launch.kind !== 'shell_module') return null;
  if (typeof launch.module !== 'string' || !launch.module.trim()) return null;

  const out: ShellToolSpecV1 = {
    schemaVersion: 1,
    id: o.id,
    name: o.name.trim(),
    description: o.description.trim(),
    semver: o.semver.trim(),
    launch: { kind: 'shell_module', module: launch.module.trim() },
    permissions,
  };

  if (typeof o.icon === 'string' && o.icon.trim()) out.icon = o.icon.trim();
  if (o.run !== undefined) {
    const run = parseRun(o.run);
    if (!run) return null;
    out.run = run;
  }
  if (o.maya !== undefined) {
    const maya = parseMaya(o.maya);
    if (!maya) return null;
    out.maya = maya;
  }
  if (typeof o.minCompanionSemver === 'string' && o.minCompanionSemver.trim()) {
    out.minCompanionSemver = o.minCompanionSemver.trim();
  }
  if (Array.isArray(o.tags)) {
    const tags: string[] = [];
    for (const t of o.tags) {
      if (typeof t !== 'string') continue;
      const s = t.trim();
      if (!s || s.length > 32 || tags.includes(s)) continue;
      tags.push(s);
      if (tags.length >= 16) break;
    }
    if (tags.length > 0) out.tags = tags;
  }
  if (o.requires && typeof o.requires === 'object') {
    const req = o.requires as Record<string, unknown>;
    if (Array.isArray(req.localEngines)) {
      const engines = req.localEngines.filter((x): x is string => typeof x === 'string' && x.length > 0);
      if (engines.length > 0) out.requires = { localEngines: engines };
    }
  }

  if (out.permissions.includes('tool.run') && !out.run) return null;
  if (out.permissions.includes('host.open') && !out.maya) return null;
  return out;
}

export function parseShellToolPanelSpecJson(raw: unknown): ShellToolPanelSpecV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) return null;
  if (typeof o.title !== 'string' || !o.title.trim()) return null;
  if (!Array.isArray(o.sections) || o.sections.length === 0) return null;
  if (!Array.isArray(o.actions) || o.actions.length === 0) return null;
  if (!Array.isArray(o.outputs) || o.outputs.length === 0) return null;

  const sections: ShellToolPanelSpecV1['sections'] = [];
  for (const sec of o.sections) {
    if (!sec || typeof sec !== 'object') return null;
    const s = sec as Record<string, unknown>;
    if (!isIdentifier(s.id) || !Array.isArray(s.fields) || s.fields.length === 0) return null;
    const fields: PanelFieldV1[] = [];
    for (const f of s.fields) {
      const field = parseField(f);
      if (!field) return null;
      fields.push(field);
    }
    sections.push({
      id: s.id,
      fields,
      ...(typeof s.title === 'string' && s.title.trim() ? { title: s.title.trim() } : {}),
    });
  }

  const actions: PanelActionV1[] = [];
  for (const act of o.actions) {
    if (!act || typeof act !== 'object') return null;
    const a = act as Record<string, unknown>;
    if (!isIdentifier(a.id) || typeof a.label !== 'string' || !a.label.trim()) return null;
    if (a.kind !== 'run' && a.kind !== 'openPath' && a.kind !== 'open_in_host') return null;
    const action: PanelActionV1 = { id: a.id, label: a.label.trim(), kind: a.kind };
    if (a.kind === 'open_in_host') {
      const host = typeof a.host === 'string' ? a.host.trim().toLowerCase() : 'maya';
      if (!(SHELL_TOOL_HOSTS as readonly string[]).includes(host)) return null;
      action.host = host as ShellToolHostV1;
    }
    if (a.style === 'primary' || a.style === 'default') action.style = a.style;
    actions.push(action);
  }

  const outputs: PanelOutputV1[] = [];
  for (const out of o.outputs) {
    if (!out || typeof out !== 'object') return null;
    const x = out as Record<string, unknown>;
    if (x.type !== 'log' || !isIdentifier(x.id) || typeof x.label !== 'string' || !x.label.trim()) return null;
    outputs.push({ type: 'log', id: x.id, label: x.label.trim() });
  }

  return { schemaVersion: 1, title: o.title.trim(), sections, actions, outputs };
}

export type ShellToolPackageValidation = {
  ok: true;
  tool: ShellToolSpecV1;
  panel: ShellToolPanelSpecV1;
};

export type ShellToolPackageValidationError = {
  ok: false;
  error: string;
};

/** Validate tool.json + panel.json from an extracted package root. */
export function validateShellToolPackageDir(extractedRoot: string): ShellToolPackageValidation | ShellToolPackageValidationError {
  const toolPath = join(extractedRoot, 'tool.json');
  if (!existsSync(toolPath)) return { ok: false, error: 'missing tool.json' };

  let toolRaw: unknown;
  try {
    toolRaw = JSON.parse(readFileSync(toolPath, 'utf8')) as unknown;
  } catch {
    return { ok: false, error: 'invalid tool.json' };
  }

  const tool = parseShellToolSpecJson(toolRaw);
  if (!tool) return { ok: false, error: 'tool_invalid_manifest' };

  const panelRel = tool.launch.module.replace(/\\/g, '/').replace(/^\//, '');
  if (panelRel.includes('..')) return { ok: false, error: 'launch.module path invalid' };

  const panelPath = join(extractedRoot, panelRel);
  if (!existsSync(panelPath)) return { ok: false, error: `missing panel: ${tool.launch.module}` };

  let panelRaw: unknown;
  try {
    panelRaw = JSON.parse(readFileSync(panelPath, 'utf8')) as unknown;
  } catch {
    return { ok: false, error: 'invalid panel.json' };
  }

  const panel = parseShellToolPanelSpecJson(panelRaw);
  if (!panel) return { ok: false, error: 'tool_invalid_manifest' };

  const fieldIds = new Set<string>();
  for (const sec of panel.sections) {
    for (const f of sec.fields) {
      if (fieldIds.has(f.id)) return { ok: false, error: `duplicate field id: ${f.id}` };
      fieldIds.add(f.id);
    }
  }

  const actionIds = new Set<string>();
  for (const a of panel.actions) {
    if (actionIds.has(a.id)) return { ok: false, error: `duplicate action id: ${a.id}` };
    actionIds.add(a.id);
    if (a.kind === 'run' && !tool.permissions.includes('tool.run')) {
      return { ok: false, error: 'run action requires tool.run permission' };
    }
    if (a.kind === 'openPath' && !tool.permissions.includes('path.pick')) {
      return { ok: false, error: 'openPath action requires path.pick permission' };
    }
    if (a.kind === 'open_in_host') {
      if (!tool.permissions.includes('host.open')) {
        return { ok: false, error: 'open_in_host action requires host.open permission' };
      }
      if (a.host === 'maya' && !tool.maya) {
        return { ok: false, error: 'open_in_host maya requires tool.json maya block' };
      }
    }
  }

  const hasPathField = panel.sections.some((s) => s.fields.some((f) => f.type === 'path'));
  if (hasPathField && !tool.permissions.includes('path.pick')) {
    return { ok: false, error: 'path field requires path.pick permission' };
  }

  return { ok: true, tool, panel };
}

export function readShellToolSpecSync(extractedRoot: string): ShellToolSpecV1 | null {
  const p = join(extractedRoot, 'tool.json');
  if (!existsSync(p)) return null;
  try {
    return parseShellToolSpecJson(JSON.parse(readFileSync(p, 'utf8')) as unknown);
  } catch {
    return null;
  }
}
