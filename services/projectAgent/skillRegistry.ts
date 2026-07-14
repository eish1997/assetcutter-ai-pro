/**
 * Project Agent Skill Registry - Phase 4.
 * Skills are local routing hints only. They can reference existing Project
 * Agent tools, but they do not execute external tools or bypass confirmation.
 */

import type {
  AgentSkill,
  AgentSkillImportPreview,
  AgentSkillPermissionLevel,
  AgentSkillSource,
  ProjectAgentToolId,
} from '../../types/projectAgent';
import { PROJECT_AGENT_TOOL_IDS } from '../../types/projectAgent';
import { readLocalJson, scopedStorageKey, writeLocalJson } from '../clientPersist';

export type AgentSkillRegistryScope = {
  userId: string | null;
  workspaceProjectId: string;
};

export type AgentSkillImportInput = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  triggers?: unknown;
  toolIds?: unknown;
  permissionLevel?: unknown;
  source?: unknown;
  enabled?: unknown;
  prompt?: unknown;
  instructions?: unknown;
};

export type InstallAgentSkillOptions = {
  confirmed?: boolean;
  enabled?: boolean;
};

const STORAGE_BASE = 'ac_project_agent_skills_v1';
const STORE_VERSION = 1 as const;
const MAX_SKILLS_PER_PROJECT = 100;
const MAX_TEXT_CHARS = 1000;
const MAX_TRIGGER_CHARS = 120;
const TOOL_ID_SET = new Set<string>(PROJECT_AGENT_TOOL_IDS);

type PersistedBlob = {
  version: typeof STORE_VERSION;
  skills: AgentSkill[];
};

const cache = new Map<string, AgentSkill[]>();

function now(): number {
  return Date.now();
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function generatedSkillId(name: string): string {
  const base = slug(name) || 'skill';
  return `skill.${base}`;
}

function permissionRank(level: AgentSkillPermissionLevel): number {
  switch (level) {
    case 'destructive':
      return 3;
    case 'cost':
      return 2;
    case 'light':
      return 1;
    default:
      return 0;
  }
}

function normalizePermission(value: unknown): AgentSkillPermissionLevel {
  return value === 'light' || value === 'cost' || value === 'destructive' ? value : 'none';
}

function normalizeSource(value: unknown): AgentSkillSource {
  return value === 'local' || value === 'preset' || value === 'expert' || value === 'imported'
    ? value
    : 'imported';
}

function stringList(value: unknown, maxChars = MAX_TRIGGER_CHARS): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = cleanText(item).slice(0, maxChars);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizeToolIds(value: unknown): {
  rawToolIds: string[];
  toolIds: ProjectAgentToolId[];
  unsupportedToolIds: string[];
} {
  const rawToolIds = stringList(value, 80);
  const toolIds = rawToolIds.filter((id): id is ProjectAgentToolId => TOOL_ID_SET.has(id));
  const unsupportedToolIds = rawToolIds.filter((id) => !TOOL_ID_SET.has(id));
  return { rawToolIds, toolIds, unsupportedToolIds };
}

function detectDangerousText(text: string): string[] {
  const warnings: string[] = [];
  if (
    /delete|remove|overwrite|publish|payment|charge|billing|credit|refund|admin|secret|api key|token/i.test(
      text
    ) ||
    /删除|移除|覆盖|发布|付款|扣费|额度|密钥|令牌/.test(text)
  ) {
    warnings.push('Contains instructions that may modify, delete, publish, bill, or expose secrets.');
  }
  if (
    /shell|powershell|cmd|terminal|filesystem|file system|network|http|https|webhook|external tool/i.test(
      text
    ) ||
    /终端|命令行|文件系统|本机|网络|外部工具/.test(text)
  ) {
    warnings.push('Mentions local, network, or external tool access that skills cannot execute directly.');
  }
  if (
    /skip confirmation|without confirmation|do not ask|no need to confirm|bypass/i.test(text) ||
    /跳过确认|无需确认|不需要确认|不要询问|绕过/.test(text)
  ) {
    warnings.push('Attempts to bypass confirmation.');
  }
  return warnings;
}

function inferPermission(
  requested: AgentSkillPermissionLevel,
  toolIds: readonly ProjectAgentToolId[],
  warnings: readonly string[]
): AgentSkillPermissionLevel {
  let inferred = requested;
  if (warnings.length > 0 && permissionRank(inferred) < permissionRank('destructive')) {
    inferred = 'destructive';
  }
  if (toolIds.some((id) => id !== 'run_plain_text') && permissionRank(inferred) < permissionRank('cost')) {
    inferred = 'cost';
  }
  return inferred;
}

export function agentSkillRegistryStorageKey(scope: AgentSkillRegistryScope): string {
  const workspaceProjectId = cleanText(scope.workspaceProjectId);
  if (!workspaceProjectId) {
    throw new Error('projectAgent/skillRegistry: workspaceProjectId is required');
  }
  return `${scopedStorageKey(STORAGE_BASE, scope.userId)}__p_${workspaceProjectId}`;
}

function normalizeSkill(raw: unknown): AgentSkill | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<AgentSkill>;
  const id = slug(cleanText(s.id));
  const name = cleanText(s.name).slice(0, 80);
  const description = cleanText(s.description).slice(0, MAX_TEXT_CHARS);
  const { toolIds } = normalizeToolIds(s.toolIds);
  if (!id || !name || !description || toolIds.length === 0) return null;

  const createdAt =
    typeof s.createdAt === 'number' && Number.isFinite(s.createdAt) ? s.createdAt : now();
  const updatedAt =
    typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : undefined;
  const deletedAt =
    typeof s.deletedAt === 'number' && Number.isFinite(s.deletedAt) ? s.deletedAt : undefined;
  const safetyWarnings = stringList(s.safetyWarnings, 240);

  return {
    id,
    name,
    description,
    triggers: stringList(s.triggers),
    toolIds,
    permissionLevel: normalizePermission(s.permissionLevel),
    source: normalizeSource(s.source),
    enabled: s.enabled !== false,
    createdAt,
    ...(updatedAt != null ? { updatedAt } : {}),
    ...(deletedAt != null ? { deletedAt } : {}),
    ...(safetyWarnings.length ? { safetyWarnings } : {}),
  };
}

function loadSkills(scope: AgentSkillRegistryScope): AgentSkill[] {
  const key = agentSkillRegistryStorageKey(scope);
  const cached = cache.get(key);
  if (cached) return cached;
  const blob = readLocalJson<PersistedBlob | null>(key, null, (parsed) => {
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as { skills?: unknown };
    if (!Array.isArray(o.skills)) return null;
    return {
      version: STORE_VERSION,
      skills: o.skills.map(normalizeSkill).filter((s): s is AgentSkill => s != null),
    };
  });
  const skills = blob?.skills ?? [];
  cache.set(key, skills);
  return skills;
}

function persistSkills(scope: AgentSkillRegistryScope, skills: AgentSkill[]): void {
  const key = agentSkillRegistryStorageKey(scope);
  cache.set(key, skills);
  writeLocalJson(key, { version: STORE_VERSION, skills } satisfies PersistedBlob);
}

function isActive(skill: AgentSkill): boolean {
  return skill.deletedAt == null;
}

function newestFirst(skills: AgentSkill[]): AgentSkill[] {
  return [...skills].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

export function previewAgentSkillImport(input: AgentSkillImportInput): AgentSkillImportPreview {
  const name = cleanText(input.name).slice(0, 80);
  const description = cleanText(input.description || input.prompt || input.instructions).slice(
    0,
    MAX_TEXT_CHARS
  );
  const triggers = stringList(input.triggers);
  const { rawToolIds, toolIds, unsupportedToolIds } = normalizeToolIds(input.toolIds);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!name) errors.push('Skill name is required.');
  if (!description) errors.push('Skill description is required.');
  if (rawToolIds.length === 0) errors.push('At least one toolId is required.');
  if (toolIds.length === 0 && rawToolIds.length > 0) {
    errors.push('At least one whitelisted toolId is required.');
  }
  if (unsupportedToolIds.length > 0) {
    errors.push(`Unsupported toolIds: ${unsupportedToolIds.join(', ')}`);
  }

  const textForScan = [
    name,
    description,
    triggers.join(' '),
    cleanText(input.instructions),
    cleanText(input.prompt),
  ].join(' ');
  warnings.push(...detectDangerousText(textForScan));

  const source = normalizeSource(input.source);
  const permissionLevel = inferPermission(normalizePermission(input.permissionLevel), toolIds, warnings);
  const requiresConfirmation =
    source === 'imported' || permissionLevel !== 'none' || warnings.length > 0;
  const id = slug(cleanText(input.id)) || generatedSkillId(name);

  return {
    ok: errors.length === 0,
    ...(errors.length === 0
      ? {
          skill: {
            id,
            name,
            description,
            triggers,
            toolIds,
            permissionLevel,
            source,
            ...(warnings.length ? { safetyWarnings: warnings } : {}),
          },
        }
      : {}),
    warnings,
    errors,
    requiresConfirmation,
  };
}

export function installAgentSkill(
  scope: AgentSkillRegistryScope,
  input: AgentSkillImportInput,
  options: InstallAgentSkillOptions = {}
): { ok: true; skill: AgentSkill } | { ok: false; preview: AgentSkillImportPreview } {
  const preview = previewAgentSkillImport(input);
  if (!preview.ok || !preview.skill) return { ok: false, preview };
  if (preview.requiresConfirmation && !options.confirmed) return { ok: false, preview };

  const timestamp = now();
  const skill: AgentSkill = {
    ...preview.skill,
    enabled: options.enabled ?? true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  let skills = loadSkills(scope).filter((s) => s.id !== skill.id);
  skills.push(skill);

  const activeSkills = newestFirst(skills.filter(isActive));
  if (activeSkills.length > MAX_SKILLS_PER_PROJECT) {
    const drop = new Set(activeSkills.slice(MAX_SKILLS_PER_PROJECT).map((s) => s.id));
    skills = skills.map((s) =>
      drop.has(s.id) && isActive(s)
        ? { ...s, enabled: false, deletedAt: timestamp, updatedAt: timestamp }
        : s
    );
  }
  persistSkills(scope, skills);
  return { ok: true, skill };
}

export function listAgentSkills(scope: AgentSkillRegistryScope): AgentSkill[] {
  return newestFirst(loadSkills(scope).filter(isActive));
}

export function listEnabledAgentSkills(scope: AgentSkillRegistryScope): AgentSkill[] {
  return listAgentSkills(scope).filter((s) => s.enabled);
}

export function setAgentSkillEnabled(
  scope: AgentSkillRegistryScope,
  skillId: string,
  enabled: boolean
): boolean {
  const id = slug(cleanText(skillId));
  if (!id) return false;
  const skills = loadSkills(scope);
  const idx = skills.findIndex((s) => s.id === id && isActive(s));
  if (idx < 0) return false;
  const next = [...skills];
  next[idx] = { ...skills[idx]!, enabled, updatedAt: now() };
  persistSkills(scope, next);
  return true;
}

export function deleteAgentSkill(scope: AgentSkillRegistryScope, skillId: string): boolean {
  const id = slug(cleanText(skillId));
  if (!id) return false;
  const skills = loadSkills(scope);
  const idx = skills.findIndex((s) => s.id === id && isActive(s));
  if (idx < 0) return false;
  const timestamp = now();
  const next = [...skills];
  next[idx] = { ...skills[idx]!, enabled: false, deletedAt: timestamp, updatedAt: timestamp };
  persistSkills(scope, next);
  return true;
}

function textMatchesSkill(text: string, skill: AgentSkill): boolean {
  const haystack = text.toLowerCase();
  if (haystack.includes(skill.name.toLowerCase())) return true;
  return skill.triggers.some((trigger) => {
    const t = trigger.toLowerCase();
    return Boolean(t) && haystack.includes(t);
  });
}

export function resolveAgentSkillsForIntent(input: {
  text: string;
  mentions?: readonly { kind: string; id: string; label?: string }[];
  skills: readonly AgentSkill[];
}): AgentSkill[] {
  const seen = new Set<string>();
  const out: AgentSkill[] = [];
  const enabled = input.skills.filter((s) => s.enabled && isActive(s));
  const push = (skill: AgentSkill | undefined) => {
    if (!skill || seen.has(skill.id)) return;
    seen.add(skill.id);
    out.push(skill);
  };

  for (const mention of input.mentions ?? []) {
    if (mention.kind !== 'skill') continue;
    const id = slug(cleanText(mention.id));
    push(enabled.find((skill) => skill.id === id));
    if (mention.label) {
      const label = cleanText(mention.label).toLowerCase();
      push(enabled.find((skill) => skill.name.toLowerCase() === label));
    }
  }

  const text = cleanText(input.text);
  if (text) {
    for (const skill of enabled) {
      if (textMatchesSkill(text, skill)) push(skill);
    }
  }
  return out;
}

export function __resetAgentSkillRegistryForTests(scope?: AgentSkillRegistryScope): void {
  if (!scope) {
    cache.clear();
    return;
  }
  cache.delete(agentSkillRegistryStorageKey(scope));
}
