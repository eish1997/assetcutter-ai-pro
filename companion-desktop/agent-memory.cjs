'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');

const NOTES_FILE = 'notes.jsonl';
const PROJECT_NOTES_FILE = 'project-notes.jsonl';
const MAX_CONTEXT_NOTES = 24;
const MAX_PROJECT_CONTEXT_NOTES = 16;
const PROJECT_MEMORY_KINDS = new Set(['decision', 'workflow', 'parameter', 'recovery', 'project_note']);
const SECRET_PATTERNS = [
  /\b(cookie|token|secret|password|passwd|authorization|api[_-]?key)\b/i,
  /sk-[A-Za-z0-9_-]{16,}/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
];

function notesFile(memoryRoot) {
  return path.join(String(memoryRoot || ''), NOTES_FILE);
}

function projectNotesFile(memoryRoot) {
  return path.join(String(memoryRoot || ''), PROJECT_NOTES_FILE);
}

function hasSecretLikeText(text) {
  const value = String(text || '');
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function safeString(value, max = 4000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeProjectMemoryKind(kind) {
  const value = String(kind || '').trim();
  return PROJECT_MEMORY_KINDS.has(value) ? value : 'project_note';
}

function normalizeTags(tags) {
  return Array.isArray(tags) ? tags.map((tag) => safeString(tag, 40)).filter(Boolean).slice(0, 10) : [];
}

function normalizeProjectId(projectId) {
  return safeString(projectId || 'unscoped', 160) || 'unscoped';
}

/**
 * @param {string} memoryRoot
 */
function listMemoryNotes(memoryRoot) {
  const file = notesFile(memoryRoot);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return out;
}

/**
 * @param {string} memoryRoot
 * @param {{ text: string; tags?: string[]; source?: string }} entry
 */
function appendMemoryNote(memoryRoot, entry) {
  const text = String(entry?.text || '').trim();
  if (!text) return { ok: false, error: 'empty_text' };
  const root = String(memoryRoot || '').trim();
  if (!root) return { ok: false, error: 'invalid_root' };
  fs.mkdirSync(root, { recursive: true });
  const note = {
    id: `mem_${randomUUID()}`,
    text: text.slice(0, 4000),
    tags: Array.isArray(entry.tags) ? entry.tags.map(String).slice(0, 8) : [],
    source: entry.source ? String(entry.source) : 'agent',
    ts: new Date().toISOString(),
  };
  fs.appendFileSync(notesFile(root), `${JSON.stringify(note)}\n`, 'utf8');
  return { ok: true, note };
}

/**
 * @param {string} memoryRoot
 * @param {{ projectId?: string; projectName?: string; kind?: string; text: string; tags?: string[]; source?: string; sourceId?: string; confirmedBy?: string; contextEnabled?: boolean }} entry
 */
function appendProjectMemoryNote(memoryRoot, entry) {
  const text = safeString(entry?.text, 4000);
  if (!text) return { ok: false, error: 'empty_text' };
  if (hasSecretLikeText(text)) return { ok: false, error: 'secret_like_text' };
  const root = safeString(memoryRoot, 2000);
  if (!root) return { ok: false, error: 'invalid_root' };
  fs.mkdirSync(root, { recursive: true });
  const note = {
    id: `pmem_${randomUUID()}`,
    scope: 'project',
    projectId: normalizeProjectId(entry?.projectId),
    projectName: safeString(entry?.projectName, 160),
    kind: normalizeProjectMemoryKind(entry?.kind),
    text,
    tags: normalizeTags(entry?.tags),
    source: safeString(entry?.source || 'copilot', 120),
    sourceId: safeString(entry?.sourceId, 160),
    confirmedBy: safeString(entry?.confirmedBy || 'user', 80),
    contextEnabled: entry?.contextEnabled === false ? false : true,
    deleted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.appendFileSync(projectNotesFile(root), `${JSON.stringify(note)}\n`, 'utf8');
  return { ok: true, note };
}

/**
 * @param {string} memoryRoot
 * @param {{ projectId?: string; includeDisabled?: boolean; includeDeleted?: boolean; kind?: string; limit?: number }} [options]
 */
function listProjectMemoryNotes(memoryRoot, options = {}) {
  const file = projectNotesFile(memoryRoot);
  if (!fs.existsSync(file)) return [];
  const projectId = options.projectId ? normalizeProjectId(options.projectId) : '';
  const kind = options.kind ? normalizeProjectMemoryKind(options.kind) : '';
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      const note = JSON.parse(line);
      if (!options.includeDeleted && note.deleted) continue;
      if (!options.includeDisabled && note.contextEnabled === false) continue;
      if (projectId && normalizeProjectId(note.projectId) !== projectId) continue;
      if (kind && normalizeProjectMemoryKind(note.kind) !== kind) continue;
      out.push(note);
    } catch {
      /* skip */
    }
  }
  const limit = Number(options.limit);
  if (Number.isFinite(limit) && limit > 0) return out.slice(-Math.min(200, Math.floor(limit)));
  return out;
}

function rewriteProjectMemoryNotes(memoryRoot, mapper) {
  const file = projectNotesFile(memoryRoot);
  if (!fs.existsSync(file)) return { ok: false, error: 'not_found' };
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  let changed = false;
  const next = [];
  for (const line of lines) {
    try {
      const note = JSON.parse(line);
      const mapped = mapper(note);
      if (mapped !== note) changed = true;
      next.push(JSON.stringify(mapped));
    } catch {
      next.push(line);
    }
  }
  if (changed) fs.writeFileSync(file, next.join('\n') + (next.length ? '\n' : ''), 'utf8');
  return { ok: changed, changed };
}

function updateProjectMemoryNote(memoryRoot, id, patch = {}) {
  const targetId = safeString(id, 120);
  if (!targetId) return { ok: false, error: 'invalid_id' };
  let updated = null;
  const result = rewriteProjectMemoryNotes(memoryRoot, (note) => {
    if (String(note.id || '') !== targetId) return note;
    updated = {
      ...note,
      contextEnabled: Object.prototype.hasOwnProperty.call(patch, 'contextEnabled')
        ? Boolean(patch.contextEnabled)
        : note.contextEnabled,
      deleted: Object.prototype.hasOwnProperty.call(patch, 'deleted') ? Boolean(patch.deleted) : note.deleted,
      updatedAt: new Date().toISOString(),
    };
    return updated;
  });
  if (!updated) return { ok: false, error: 'not_found' };
  return { ok: true, note: updated, changed: result.changed };
}

function summarizeProjectMemory(memoryRoot, options = {}) {
  const notes = listProjectMemoryNotes(memoryRoot, { ...options, includeDisabled: true, limit: options.limit || 200 });
  const active = notes.filter((note) => note && note.contextEnabled !== false && !note.deleted);
  const byKind = {};
  for (const note of active) {
    const kind = normalizeProjectMemoryKind(note.kind);
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  return {
    projectId: options.projectId ? normalizeProjectId(options.projectId) : '',
    total: notes.length,
    active: active.length,
    disabled: notes.length - active.length,
    byKind,
    latest: active.slice(-5).reverse(),
  };
}

/**
 * @param {string} memoryRoot
 */
function buildMemoryContextBlock(memoryRoot) {
  const notes = listMemoryNotes(memoryRoot);
  if (!notes.length) return '';
  const recent = notes.slice(-MAX_CONTEXT_NOTES);
  const lines = recent.map((n) => `- [${n.ts || ''}] ${String(n.text || '').slice(0, 200)}`);
  return `用户记忆（agent-store/memory）：\n${lines.join('\n')}`;
}

function buildProjectMemoryContextBlock(memoryRoot, options = {}) {
  const notes = listProjectMemoryNotes(memoryRoot, {
    projectId: options.projectId,
    limit: MAX_PROJECT_CONTEXT_NOTES,
  });
  if (!notes.length) return '';
  const lines = notes.map((n) => {
    const kind = normalizeProjectMemoryKind(n.kind);
    return `- [${kind}] ${String(n.text || '').slice(0, 220)}`;
  });
  return `Project memory:\n${lines.join('\n')}`;
}

module.exports = {
  listMemoryNotes,
  appendMemoryNote,
  buildMemoryContextBlock,
  appendProjectMemoryNote,
  listProjectMemoryNotes,
  updateProjectMemoryNote,
  summarizeProjectMemory,
  buildProjectMemoryContextBlock,
  MAX_CONTEXT_NOTES,
  MAX_PROJECT_CONTEXT_NOTES,
};
