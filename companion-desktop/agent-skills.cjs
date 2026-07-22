'use strict';

const fs = require('fs');
const path = require('path');

/**
 * P2：从 agent-store/skills/ 加载可复用剧本（agentskills.io 简化子集）。
 * 每个 skill 目录含 skill.json 或 SKILL.md（首段 YAML frontmatter 可选）。
 */

/**
 * @param {string} skillsRoot
 */
function listSkillEntries(skillsRoot) {
  const root = String(skillsRoot || '').trim();
  if (!root || !fs.existsSync(root)) return [];
  const out = [];
  for (const name of fs.readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const dir = path.join(root, name.name);
    const jsonPath = path.join(dir, 'skill.json');
    const mdPath = path.join(dir, 'SKILL.md');
    if (fs.existsSync(jsonPath)) {
      try {
        const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        out.push(normalizeSkill(j, name.name, dir));
      } catch {
        /* skip */
      }
    } else if (fs.existsSync(mdPath)) {
      out.push(parseSkillMarkdown(fs.readFileSync(mdPath, 'utf8'), name.name, dir));
    }
  }
  return out.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeSkill(raw, fallbackId, dir) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || fallbackId).trim();
  if (!id) return null;
  return {
    id,
    name: String(raw.name || id),
    description: String(raw.description || '').trim(),
    prompt: String(raw.prompt || raw.instructions || '').trim(),
    toolHints: Array.isArray(raw.toolHints) ? raw.toolHints.map(String) : [],
    workbenchPreset: raw.workbenchPreset && typeof raw.workbenchPreset === 'object' ? raw.workbenchPreset : null,
    scriptManifest: raw.scriptManifest && typeof raw.scriptManifest === 'object' ? raw.scriptManifest : null,
    revision: Number.isFinite(Number(raw.revision)) ? Math.max(1, Math.floor(Number(raw.revision))) : 1,
    createdAt: raw.createdAt ? String(raw.createdAt) : '',
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : '',
    revisionCount: countSkillRevisions(dir),
    path: dir,
  };
}

function parseSkillMarkdown(raw, fallbackId, dir) {
  const text = String(raw || '');
  let body = text;
  let meta = {};
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
    body = fm[2].trim();
  }
  const firstLine = body.split('\n').find((l) => l.trim()) || '';
  const title = firstLine.replace(/^#\s*/, '').trim();
  return {
    id: String(meta.id || fallbackId).trim(),
    name: String(meta.name || title || fallbackId),
    description: String(meta.description || body.slice(0, 240)).trim(),
    prompt: body.trim(),
    toolHints: [],
    path: dir,
  };
}

/**
 * @param {string} skillsRoot
 * @param {string} skillId
 */
function readSkillById(skillsRoot, skillId) {
  const id = String(skillId || '').trim();
  if (!id) return null;
  return listSkillEntries(skillsRoot).find((s) => s.id === id) || null;
}

function normalizeSkillId(raw) {
  const id = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!id || id === '.' || id === '..' || id.includes('..')) return '';
  return id;
}

function assertInsideRoot(root, target) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  const rel = path.relative(rootPath, targetPath);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function normalizeToolHints(value) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const name = String(raw || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.sort();
}

function countSkillRevisions(dir) {
  try {
    const revisionsDir = path.join(dir, 'revisions');
    if (!fs.existsSync(revisionsDir)) return 0;
    return fs.readdirSync(revisionsDir).filter((name) => name.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} skillsRoot
 * @param {string} skillId
 */
function listSkillRevisions(skillsRoot, skillId) {
  const root = String(skillsRoot || '').trim();
  if (!root) return { ok: false, error: 'skills_root_missing' };
  const id = normalizeSkillId(skillId);
  if (!id) return { ok: false, error: 'invalid_skill_id' };
  const dir = path.join(root, id);
  if (!assertInsideRoot(root, dir)) return { ok: false, error: 'invalid_skill_path' };
  const currentFile = path.join(dir, 'skill.json');
  if (!fs.existsSync(currentFile)) return { ok: false, error: 'skill_not_found' };
  const revisionsDir = path.join(dir, 'revisions');
  const archived = fs.existsSync(revisionsDir)
    ? fs
        .readdirSync(revisionsDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => ({ name, file: path.join(revisionsDir, name), data: readJsonFile(path.join(revisionsDir, name)) }))
        .filter((entry) => entry.data && typeof entry.data === 'object')
        .map((entry) => ({
          kind: 'archived',
          revision: Number.isFinite(Number(entry.data.revision)) ? Math.max(1, Math.floor(Number(entry.data.revision))) : 1,
          name: String(entry.data.name || id),
          description: String(entry.data.description || ''),
          createdAt: entry.data.createdAt ? String(entry.data.createdAt) : '',
          updatedAt: entry.data.updatedAt ? String(entry.data.updatedAt) : '',
          file: entry.name,
        }))
    : [];
  const current = readJsonFile(currentFile);
  const currentSummary =
    current && typeof current === 'object'
      ? {
          kind: 'current',
          revision: Number.isFinite(Number(current.revision)) ? Math.max(1, Math.floor(Number(current.revision))) : 1,
          name: String(current.name || id),
          description: String(current.description || ''),
          createdAt: current.createdAt ? String(current.createdAt) : '',
          updatedAt: current.updatedAt ? String(current.updatedAt) : '',
          file: 'skill.json',
        }
      : null;
  const revisions = [...archived, ...(currentSummary ? [currentSummary] : [])].sort((a, b) => a.revision - b.revision);
  return {
    ok: true,
    skillId: id,
    total: revisions.length,
    currentRevision: currentSummary ? currentSummary.revision : null,
    revisions,
    resourceUri: `skill://${id}/revisions`,
  };
}

/**
 * @param {string} skillsRoot
 * @param {string} skillId
 * @param {number | string} revision
 */
function readSkillRevision(skillsRoot, skillId, revision) {
  const listed = listSkillRevisions(skillsRoot, skillId);
  if (!listed.ok) return listed;
  const wanted = Number(revision);
  if (!Number.isInteger(wanted) || wanted < 1) return { ok: false, error: 'invalid_revision' };
  const entry = listed.revisions.find((item) => item.revision === wanted);
  if (!entry) return { ok: false, error: 'revision_not_found' };
  const root = String(skillsRoot || '').trim();
  const id = listed.skillId;
  const dir = path.join(root, id);
  const file = entry.kind === 'current' ? path.join(dir, 'skill.json') : path.join(dir, 'revisions', entry.file);
  if (!assertInsideRoot(root, file)) return { ok: false, error: 'invalid_revision_path' };
  const data = readJsonFile(file);
  if (!data || typeof data !== 'object') return { ok: false, error: 'revision_not_found' };
  return {
    ok: true,
    skillId: id,
    revision: wanted,
    kind: entry.kind,
    skill: normalizeSkill(data, id, dir),
    resourceUri: `skill://${id}/revisions/${wanted}`,
  };
}

function revisionFileName(updatedAt, fallbackDate) {
  const stamp = String(updatedAt || fallbackDate || new Date().toISOString())
    .replace(/[^0-9a-zA-Z._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${stamp || 'revision'}.json`;
}

function archiveExistingSkill(file, dir, now) {
  if (!fs.existsSync(file)) return { archived: false, previous: null };
  try {
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    const revisionsDir = path.join(dir, 'revisions');
    fs.mkdirSync(revisionsDir, { recursive: true });
    let name = revisionFileName(previous.updatedAt, now);
    let target = path.join(revisionsDir, name);
    let i = 1;
    while (fs.existsSync(target)) {
      name = revisionFileName(`${previous.updatedAt || now}-${i}`, now);
      target = path.join(revisionsDir, name);
      i += 1;
    }
    fs.writeFileSync(target, `${JSON.stringify(previous, null, 2)}\n`, 'utf8');
    return { archived: true, previous };
  } catch {
    return { archived: false, previous: null };
  }
}

/**
 * @param {string} skillsRoot
 * @param {{ id?: string; skillId?: string; name?: string; description?: string; prompt?: string; instructions?: string; toolHints?: string[]; workbenchPreset?: object; scriptManifest?: object }} input
 */
function saveSkill(skillsRoot, input) {
  const root = String(skillsRoot || '').trim();
  if (!root) return { ok: false, error: 'skills_root_missing' };
  const raw = input && typeof input === 'object' ? input : {};
  const id = normalizeSkillId(raw.id || raw.skillId || raw.name);
  if (!id) return { ok: false, error: 'invalid_skill_id' };
  const prompt = String(raw.prompt || raw.instructions || '').trim();
  if (!prompt) return { ok: false, error: 'prompt_required' };
  const dir = path.join(root, id);
  if (!assertInsideRoot(root, dir)) return { ok: false, error: 'invalid_skill_path' };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'skill.json');
  const now = new Date().toISOString();
  const archived = archiveExistingSkill(file, dir, now);
  const previous = archived.previous && typeof archived.previous === 'object' ? archived.previous : null;
  const previousRevision = previous && Number.isFinite(Number(previous.revision)) ? Math.max(1, Number(previous.revision)) : 0;
  const hasScriptManifest = Object.prototype.hasOwnProperty.call(raw, 'scriptManifest');
  const hasWorkbenchPreset = Object.prototype.hasOwnProperty.call(raw, 'workbenchPreset');
  const workbenchPreset =
    hasWorkbenchPreset && raw.workbenchPreset && typeof raw.workbenchPreset === 'object'
      ? raw.workbenchPreset
      : !hasWorkbenchPreset && previous && previous.workbenchPreset && typeof previous.workbenchPreset === 'object'
        ? previous.workbenchPreset
        : null;
  const scriptManifest =
    hasScriptManifest && raw.scriptManifest && typeof raw.scriptManifest === 'object'
      ? raw.scriptManifest
      : !hasScriptManifest && previous && previous.scriptManifest && typeof previous.scriptManifest === 'object'
        ? previous.scriptManifest
        : null;
  const skill = {
    id,
    name: String(raw.name || id).trim().slice(0, 120) || id,
    description: String(raw.description || '').trim().slice(0, 500),
    prompt,
    toolHints: normalizeToolHints(raw.toolHints),
    ...(workbenchPreset ? { workbenchPreset } : {}),
    ...(scriptManifest ? { scriptManifest } : {}),
    revision: previousRevision + 1,
    createdAt: previous && previous.createdAt ? String(previous.createdAt) : now,
    updatedAt: now,
  };
  fs.writeFileSync(file, `${JSON.stringify(skill, null, 2)}\n`, 'utf8');
  return {
    ok: true,
    skill: normalizeSkill(skill, id, dir),
    revision: skill.revision,
    previousArchived: archived.archived,
    path: file,
    resourceUri: `skill://${id}`,
    promptName: `skill:${id}`,
  };
}

/**
 * @param {string} skillsRoot
 * @param {string} skillId
 */
function deleteSkill(skillsRoot, skillId) {
  const root = String(skillsRoot || '').trim();
  if (!root) return { ok: false, error: 'skills_root_missing' };
  const id = normalizeSkillId(skillId);
  if (!id) return { ok: false, error: 'invalid_skill_id' };
  const dir = path.join(root, id);
  if (!assertInsideRoot(root, dir)) return { ok: false, error: 'invalid_skill_path' };
  if (!fs.existsSync(dir)) return { ok: false, error: 'skill_not_found' };
  const before = readSkillById(root, id);
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    ok: true,
    skillId: id,
    deleted: Boolean(before),
    resourceUri: `skill://${id}`,
    promptName: `skill:${id}`,
  };
}

/**
 * @param {string} skillsRoot
 */
function buildSkillsContextBlock(skillsRoot) {
  const skills = listSkillEntries(skillsRoot);
  if (!skills.length) return '';
  const lines = skills.map((s) => `- ${s.id}: ${s.name}${s.description ? ` — ${s.description}` : ''}`);
  return `可用 Skills（agent-store/skills）：\n${lines.join('\n')}`;
}

module.exports = {
  listSkillEntries,
  readSkillById,
  listSkillRevisions,
  readSkillRevision,
  saveSkill,
  deleteSkill,
  buildSkillsContextBlock,
};
