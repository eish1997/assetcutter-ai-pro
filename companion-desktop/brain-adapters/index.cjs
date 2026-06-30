'use strict';

const { createStubBrainAdapter } = require('./stub.cjs');
const { createOpenaiCompatBrainAdapter } = require('./openai_compat.cjs');
const { createHermesBrainAdapter } = require('./hermes.cjs');
const { createClaudeCodeBrainAdapter } = require('./claude_code.cjs');
const { createCodexBrainAdapter } = require('./codex.cjs');

/** @type {Array<{ id: string; displayName: string }>} */
const BRAIN_CATALOG = [
  { id: 'stub', displayName: 'Stub（P0 联调）' },
  { id: 'hermes', displayName: 'Hermes Gateway' },
  { id: 'openai_compat', displayName: 'OpenAI Compatible' },
  { id: 'claude_code', displayName: 'Claude Code' },
  { id: 'codex', displayName: 'Codex' },
];

/**
 * @param {string} brainId
 * @param {{ store?: ReturnType<import('../agent-store.cjs').createAgentStore> }} [deps]
 */
function createBrainAdapter(brainId, deps) {
  const id = String(brainId || 'stub').trim() || 'stub';
  if (id === 'hermes') return createHermesBrainAdapter(deps || {});
  if (id === 'openai_compat') return createOpenaiCompatBrainAdapter(deps || {});
  if (id === 'claude_code') return createClaudeCodeBrainAdapter(deps || {});
  if (id === 'codex') return createCodexBrainAdapter(deps || {});
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
