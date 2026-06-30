'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');

const NOTES_FILE = 'notes.jsonl';
const MAX_CONTEXT_NOTES = 24;

function notesFile(memoryRoot) {
  return path.join(String(memoryRoot || ''), NOTES_FILE);
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
 */
function buildMemoryContextBlock(memoryRoot) {
  const notes = listMemoryNotes(memoryRoot);
  if (!notes.length) return '';
  const recent = notes.slice(-MAX_CONTEXT_NOTES);
  const lines = recent.map((n) => `- [${n.ts || ''}] ${String(n.text || '').slice(0, 200)}`);
  return `用户记忆（agent-store/memory）：\n${lines.join('\n')}`;
}

module.exports = { listMemoryNotes, appendMemoryNote, buildMemoryContextBlock, MAX_CONTEXT_NOTES };
