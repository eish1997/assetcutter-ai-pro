'use strict';

const { createStubBrainAdapter } = require('./stub.cjs');
const { createCodexBrainAdapter } = require('./codex.cjs');

/** @type {Array<{ id: string; displayName: string }>} */
const BRAIN_CATALOG = [
  { id: 'codex', displayName: 'Codex CLI' },
];

/**
 * @param {string} brainId
 * @param {{ store?: ReturnType<import('../agent-store.cjs').createAgentStore> }} [deps]
 */
function createBrainAdapter(brainId, deps) {
  const id = String(brainId || 'stub').trim() || 'stub';
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
  createCodexBrainAdapter,
};
