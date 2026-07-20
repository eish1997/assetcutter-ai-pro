'use strict';

const { createStubBrainAdapter } = require('./stub.cjs');
const { createOpenaiCompatBrainAdapter } = require('./openai_compat.cjs');
const { createHermesBrainAdapter } = require('./hermes.cjs');
const { createClaudeCodeBrainAdapter } = require('./claude_code.cjs');
const { createCodexBrainAdapter } = require('./codex.cjs');

/** @type {Array<{ id: string; displayName: string }>} */
const BRAIN_CATALOG = [
  { id: 'codex', displayName: 'Codex CLI' },
  { id: 'stub', displayName: 'Stub' },
  { id: 'hermes', displayName: 'Hermes Gateway' },
  { id: 'openai_compat', displayName: 'OpenAI Compatible' },
  { id: 'claude_code', displayName: 'Claude Code' },
];

/**
 * @param {string} brainId
 * @param {{ store?: ReturnType<import('../agent-store.cjs').createAgentStore> }} [deps]
 */
function createBrainAdapter(brainId, deps) {
  const id = String(brainId || 'stub').trim() || 'stub';
  if (id === 'codex') return createCodexBrainAdapter(deps || {});
  if (id === 'hermes') return createHermesBrainAdapter(deps || {});
  if (id === 'openai_compat') return createOpenaiCompatBrainAdapter(deps || {});
  if (id === 'claude_code') return createClaudeCodeBrainAdapter(deps || {});
  return createStubBrainAdapter();
}

function listBrainCatalog() {
  return [...BRAIN_CATALOG];
}

module.exports = {
  createBrainAdapter,
  listBrainCatalog,
  createStubBrainAdapter,
  createOpenaiCompatBrainAdapter,
  createHermesBrainAdapter,
  createClaudeCodeBrainAdapter,
  createCodexBrainAdapter,
};
