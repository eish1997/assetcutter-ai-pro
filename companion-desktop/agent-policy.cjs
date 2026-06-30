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
      return {
        ...DEFAULT_POLICY,
        ...j,
        autoConfirmTools: Array.isArray(j.autoConfirmTools) ? j.autoConfirmTools : [],
        forbiddenTools: Array.isArray(j.forbiddenTools) ? j.forbiddenTools : [],
      };
    } catch {
      return { ...DEFAULT_POLICY };
    }
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

  return { readPolicy, gateTool, DEFAULT_POLICY };
}

module.exports = { createAgentPolicy, DEFAULT_POLICY };
