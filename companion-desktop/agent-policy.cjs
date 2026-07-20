'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_POLICY = {
  schemaVersion: 1,
  confirmTools: true,
  autoConfirmTools: [],
  forbiddenTools: [],
  directoryAllowlist: [],
};

/**
 * @param {{ getPolicyPath: () => string }} deps
 */
function createAgentPolicy(deps) {
  function policyPath() {
    return deps.getPolicyPath();
  }

  function ensurePolicyFile() {
    const p = policyPath();
    if (!fs.existsSync(p)) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`, 'utf8');
    }
  }

  function readPolicy() {
    ensurePolicyFile();
    try {
      const j = JSON.parse(fs.readFileSync(policyPath(), 'utf8'));
      return normalizePolicy(j);
    } catch {
      return { ...DEFAULT_POLICY };
    }
  }

  function normalizeToolNames(value) {
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

  function normalizePolicy(raw) {
    const j = raw && typeof raw === 'object' ? raw : {};
    const forbiddenTools = normalizeToolNames(j.forbiddenTools);
    const forbidden = new Set(forbiddenTools);
    return {
      ...DEFAULT_POLICY,
      ...j,
      schemaVersion: 1,
      confirmTools: j.confirmTools != null ? Boolean(j.confirmTools) : DEFAULT_POLICY.confirmTools,
      autoConfirmTools: normalizeToolNames(j.autoConfirmTools).filter((name) => !forbidden.has(name)),
      forbiddenTools,
      directoryAllowlist: normalizeToolNames(j.directoryAllowlist),
    };
  }

  function writePolicy(patch) {
    ensurePolicyFile();
    const next = normalizePolicy({ ...readPolicy(), ...(patch && typeof patch === 'object' ? patch : {}) });
    fs.mkdirSync(path.dirname(policyPath()), { recursive: true });
    fs.writeFileSync(policyPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  /**
   * @param {{ risk: string; name: string }} tool
   * @returns {'allow' | 'confirm' | 'deny'}
   */
  function gateTool(tool) {
    const policy = readPolicy();
    if (policy.forbiddenTools.includes(tool.name)) return 'deny';
    if (tool.risk === 'forbidden') return 'deny';
    if (tool.risk === 'safe') return 'allow';
    if (tool.risk === 'confirm') {
      if (!policy.confirmTools) return 'allow';
      if (policy.autoConfirmTools.includes(tool.name)) return 'allow';
      return 'confirm';
    }
    return 'confirm';
  }

  return { readPolicy, writePolicy, gateTool, DEFAULT_POLICY };
}

module.exports = { createAgentPolicy, DEFAULT_POLICY };
