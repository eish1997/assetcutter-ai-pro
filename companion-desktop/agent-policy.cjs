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

const AUTO_CONFIRM_ELIGIBLE_TOOLS = ['ac.workbench.run_capability'];

const ADMIN_POLICY_TEMPLATES = [
  {
    id: 'member_safe',
    name: 'Member safe',
    description: 'Default member mode: safe reads run, risky writes ask, memory writes ask.',
    patch: {
      confirmTools: true,
      autoConfirmTools: ['ac.shell.get_state', 'ac.workbench.get_context', 'ac.workbench.list_assets', 'ac.workbench.get_asset'],
      forbiddenTools: [],
    },
  },
  {
    id: 'workflow_admin',
    name: 'Workflow admin',
    description: 'Workflow builder mode: allow draft lifecycle and read-only probes, keep promotion gated.',
    patch: {
      confirmTools: true,
      autoConfirmTools: [
        'ac.shell.get_state',
        'ac.workbench.get_context',
        'ac.workbench.list_assets',
        'ac.workbench.get_asset',
        'ac.skills.save',
        'ac.skills.delete',
        'ac.usage.probe_quota_policy',
      ],
      forbiddenTools: [],
    },
  },
  {
    id: 'locked_down',
    name: 'Locked down',
    description: 'Review mode: no persistent memory writes, workflow promotion, or cloud usage upload.',
    patch: {
      confirmTools: true,
      autoConfirmTools: ['ac.shell.get_state', 'ac.workbench.get_context'],
      forbiddenTools: [
        'ac.memory.append',
        'ac.workflow.promote_workbench_preset',
        'ac.workflow.promote_script_hub_tool',
        'ac.usage.upload_cloud_draft',
      ],
    },
  },
];

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

  function isAutoConfirmEligible(tool) {
    if (!tool || tool.risk !== 'confirm') return false;
    if (tool.autoConfirmEligible === true) return true;
    return AUTO_CONFIRM_ELIGIBLE_TOOLS.includes(tool.name);
  }

  function writePolicy(patch) {
    ensurePolicyFile();
    const next = normalizePolicy({ ...readPolicy(), ...(patch && typeof patch === 'object' ? patch : {}) });
    fs.mkdirSync(path.dirname(policyPath()), { recursive: true });
    fs.writeFileSync(policyPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  function listPolicyTemplates() {
    return ADMIN_POLICY_TEMPLATES.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      patch: normalizePolicy(template.patch),
    }));
  }

  function applyPolicyTemplate(templateId) {
    const id = String(templateId || '').trim();
    const template = ADMIN_POLICY_TEMPLATES.find((item) => item.id === id);
    if (!template) return { ok: false, error: 'template_not_found' };
    return { ok: true, template: template.id, policy: writePolicy(template.patch) };
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
      if (policy.autoConfirmTools.includes(tool.name) && isAutoConfirmEligible(tool)) return 'allow';
      return 'confirm';
    }
    return 'confirm';
  }

  return { readPolicy, writePolicy, listPolicyTemplates, applyPolicyTemplate, gateTool, isAutoConfirmEligible, DEFAULT_POLICY };
}

module.exports = { createAgentPolicy, DEFAULT_POLICY, ADMIN_POLICY_TEMPLATES, AUTO_CONFIRM_ELIGIBLE_TOOLS };
