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

/**
 * @param {string} skillsRoot
 */
function buildSkillsContextBlock(skillsRoot) {
  const skills = listSkillEntries(skillsRoot);
  if (!skills.length) return '';
  const lines = skills.map((s) => `- ${s.id}: ${s.name}${s.description ? ` — ${s.description}` : ''}`);
  return `可用 Skills（agent-store/skills）：\n${lines.join('\n')}`;
}

module.exports = { listSkillEntries, readSkillById, buildSkillsContextBlock };
