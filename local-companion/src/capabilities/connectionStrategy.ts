import type { ConnectionFactEvidence } from './connectionFacts.js';

export type ConnectionStrategyKind =
  | 'existing_process_probe'
  | 'project_plugin'
  | 'engine_plugin'
  | 'script_folder'
  | 'startup_script'
  | 'command_port'
  | 'http_probe'
  | 'heartbeat_file'
  | 'extension_panel'
  | 'manual_bridge_script';

export type ConnectionStrategyRisk = 'low' | 'medium' | 'high';
export type ConnectionStrategyStatus = 'verified' | 'planned';

export type ConnectionStrategyFailureClass =
  | 'missing_path'
  | 'permission_denied'
  | 'unsupported_layout'
  | 'install_failed'
  | 'probe_failed'
  | 'host_not_running'
  | 'user_action_required'
  | 'unknown';

export type ConnectionStrategyPlanStep = {
  kind: string;
  target?: string;
  description: string;
};

export type ConnectionStrategyPlan = {
  steps: ConnectionStrategyPlanStep[];
  expectedEvidence: string[];
};

export type ConnectionStrategy = {
  id: string;
  label: string;
  kind: ConnectionStrategyKind;
  risk: ConnectionStrategyRisk;
  requiresUserDirs: string[];
  installPlan: ConnectionStrategyPlan;
  probePlan: ConnectionStrategyPlan;
  uninstallPlan: ConnectionStrategyPlan;
  safetyBoundary: string[];
  confidence: number;
  status: ConnectionStrategyStatus;
  verified: boolean;
  failureClass?: ConnectionStrategyFailureClass;
  evidence: ConnectionFactEvidence[];
};

export type ConnectionStrategyInput = Partial<ConnectionStrategy> & {
  id: string;
  label?: string;
  kind: ConnectionStrategyKind;
};

const RISKS = new Set<ConnectionStrategyRisk>(['low', 'medium', 'high']);
const STATUSES = new Set<ConnectionStrategyStatus>(['verified', 'planned']);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.map(text).filter(Boolean))).slice(0, 24) : [];
}

function confidence(value: unknown): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 0.1;
  return Math.max(0, Math.min(1, Number(number.toFixed(2))));
}

function plan(value: unknown): ConnectionStrategyPlan {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<ConnectionStrategyPlan>) : {};
  const steps = Array.isArray(record.steps)
    ? record.steps
        .map((step) => {
          const row = step && typeof step === 'object' && !Array.isArray(step) ? (step as Record<string, unknown>) : {};
          const description = text(row.description);
          if (!description) return null;
          return {
            kind: text(row.kind) || 'manual',
            ...(text(row.target) ? { target: text(row.target) } : {}),
            description,
          };
        })
        .filter((step): step is ConnectionStrategyPlanStep => Boolean(step))
    : [];
  return {
    steps,
    expectedEvidence: list(record.expectedEvidence),
  };
}

function evidence(value: unknown): ConnectionFactEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
      const source = text(row.source) || 'unknown';
      const at = text(row.at) || new Date(0).toISOString();
      const path = text(row.path);
      const processName = text(row.processName);
      const factValue = text(row.value);
      const note = text(row.note);
      if (!path && !processName && !factValue && !note) return null;
      return {
        source: source as ConnectionFactEvidence['source'],
        at,
        ...(path ? { path } : {}),
        ...(processName ? { processName } : {}),
        ...(factValue ? { value: factValue } : {}),
        ...(note ? { note } : {}),
      };
    })
    .filter((item): item is ConnectionFactEvidence => Boolean(item));
}

export function normalizeConnectionStrategy(input: ConnectionStrategyInput): ConnectionStrategy {
  const risk = RISKS.has(input.risk as ConnectionStrategyRisk) ? (input.risk as ConnectionStrategyRisk) : 'medium';
  const status = STATUSES.has(input.status as ConnectionStrategyStatus)
    ? (input.status as ConnectionStrategyStatus)
    : input.verified
      ? 'verified'
      : 'planned';
  const verified = status === 'verified' && input.verified !== false;
  return {
    id: text(input.id),
    label: text(input.label) || text(input.id),
    kind: input.kind,
    risk,
    requiresUserDirs: list(input.requiresUserDirs),
    installPlan: plan(input.installPlan),
    probePlan: plan(input.probePlan),
    uninstallPlan: plan(input.uninstallPlan),
    safetyBoundary: list(input.safetyBoundary),
    confidence: confidence(input.confidence),
    status,
    verified,
    ...(input.failureClass ? { failureClass: input.failureClass } : {}),
    evidence: evidence(input.evidence),
  };
}
