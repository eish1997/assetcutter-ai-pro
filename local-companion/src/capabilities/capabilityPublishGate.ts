import { readCapabilityPackageDraft, type CapabilityPackageDraft } from './capabilityPackageStore.js';
import { resolveSoftwareBridgeStrategies } from './softwareBridgeRegistry.js';

export type CapabilityPublishGateInput = {
  actorRole?: string;
  isAdmin?: boolean;
  versionNote?: string;
};

export type CapabilityPublishGateResult = {
  ok: boolean;
  publishable: boolean;
  code: string;
  message: string;
  packageId: string;
  packageType?: string;
  source?: string;
  requiredGates: string[];
  passedGates: string[];
  missingGates: string[];
  cloudHistoryIncluded: false;
  publishCandidate?: {
    id: string;
    type: CapabilityPackageDraft['type'];
    source: CapabilityPackageDraft['source'];
    name: string;
    description: string;
    tags: string[];
    version?: string;
    manifest: Record<string, unknown>;
    lifecycle: CapabilityPackageDraft['lifecycle'];
    conversation: CapabilityPackageDraft['conversation'];
    governance: CapabilityPackageDraft['governance'];
    versionNote: string;
    verifiedStrategyId?: string;
  };
};

function isAdminActor(input: CapabilityPublishGateInput): boolean {
  if (input.isAdmin === true) return true;
  const role = String(input.actorRole || '').trim().toLowerCase();
  return role === 'admin' || role === 'super' || role === 'owner';
}

function hasSuccessfulRealProbe(draft: CapabilityPackageDraft): boolean {
  const probe = draft.lastProbe && typeof draft.lastProbe === 'object' ? (draft.lastProbe as Record<string, unknown>) : null;
  if (!probe || probe.ok !== true) return false;
  const result = probe.result && typeof probe.result === 'object' ? (probe.result as Record<string, unknown>) : null;
  if (!result) return true;
  if (result.mock === true || result.synthetic === true || result.source === 'mock') return false;
  return true;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function verifiedStrategyIdForPublish(draft: CapabilityPackageDraft): string {
  if (draft.type !== 'software_connection') return '';
  const probe = record(draft.lastProbe);
  if (probe.ok !== true) return '';
  const result = record(probe.result);
  const candidates = [
    text(probe.verifiedStrategyId),
    text(probe.strategyId),
    text(probe.connectionStrategyId),
    text(result.verifiedStrategyId),
    text(result.strategyId),
    text(result.connectionStrategyId),
  ].filter(Boolean);
  if (!candidates.length) return '';
  const verifiedIds = new Set(
    resolveSoftwareBridgeStrategies(draft)
      .filter((strategy) => strategy.verified === true && strategy.status === 'verified')
      .map((strategy) => strategy.id),
  );
  return candidates.find((id) => verifiedIds.has(id)) || '';
}

export function checkCapabilityPublishGate(
  id: string,
  input: CapabilityPublishGateInput = {},
): CapabilityPublishGateResult {
  const packageId = String(id || '').trim();
  const draft = readCapabilityPackageDraft(packageId);
  if (!draft) {
    return {
      ok: false,
      publishable: false,
      code: 'capability_not_found',
      message: 'Capability package not found.',
      packageId,
      requiredGates: ['package_exists'],
      passedGates: [],
      missingGates: ['package_exists'],
      cloudHistoryIncluded: false,
    };
  }

  const requiredGates = ['package_exists', 'cloud_versioned', 'version_note'];
  if (draft.governance.requiresAdminToPublish) requiredGates.push('admin_actor');
  if (draft.governance.requiresRealProbeToPublish) requiredGates.push('real_probe_passed');
  if (draft.type === 'software_connection') requiredGates.push('verified_strategy_recorded');
  requiredGates.push('local_cloud_history_isolated');

  const passedGates = ['package_exists'];
  const verifiedStrategyId = verifiedStrategyIdForPublish(draft);
  if (draft.governance.cloudVersioned === true) passedGates.push('cloud_versioned');
  if (String(input.versionNote || '').trim()) passedGates.push('version_note');
  if (!draft.governance.requiresAdminToPublish || isAdminActor(input)) passedGates.push('admin_actor');
  if (!draft.governance.requiresRealProbeToPublish || hasSuccessfulRealProbe(draft)) {
    passedGates.push('real_probe_passed');
  }
  if (draft.type !== 'software_connection' || verifiedStrategyId) passedGates.push('verified_strategy_recorded');
  passedGates.push('local_cloud_history_isolated');

  const missingGates = requiredGates.filter((gate) => !passedGates.includes(gate));
  const publishable = missingGates.length === 0;
  return {
    ok: publishable,
    publishable,
    code: publishable ? 'capability_publish_gate_passed' : 'capability_publish_gate_blocked',
    message: publishable
      ? 'Capability package can be submitted to governed cloud publishing.'
      : 'Capability package is not ready for governed cloud publishing.',
    packageId: draft.id,
    packageType: draft.type,
    source: draft.source,
    requiredGates,
    passedGates,
    missingGates,
    cloudHistoryIncluded: false,
    ...(publishable
      ? {
          publishCandidate: {
            id: draft.id,
            type: draft.type,
            source: draft.source,
            name: draft.name,
            description: draft.description,
            tags: draft.tags,
            ...(draft.version ? { version: draft.version } : {}),
            manifest:
              draft.type === 'software_connection' && verifiedStrategyId
                ? { ...draft.manifest, verifiedStrategyId }
                : draft.manifest,
            lifecycle: draft.lifecycle,
            conversation: draft.conversation,
            governance: draft.governance,
            versionNote: String(input.versionNote || '').trim(),
            ...(verifiedStrategyId ? { verifiedStrategyId } : {}),
          },
        }
      : {}),
  };
}
