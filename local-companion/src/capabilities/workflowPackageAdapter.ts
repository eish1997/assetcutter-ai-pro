import {
  assertValidCapabilityPackage,
  normalizeCapabilityId,
  type CapabilityPackage,
} from './capabilityPackages.js';

export type WorkflowPackageInput = {
  id?: string;
  name: string;
  description?: string;
  tags?: string[];
  semver?: string;
  manifest?: Record<string, unknown>;
};

export function workflowDraftToCapabilityPackage(input: WorkflowPackageInput): CapabilityPackage {
  const id = normalizeCapabilityId(input.id || input.name || 'workflow');
  if (!id) throw new Error('workflow_capability_id_required');
  const manifest = input.manifest && typeof input.manifest === 'object' ? input.manifest : {};
  const pkg: CapabilityPackage = {
    id,
    type: 'workflow',
    source: 'draft',
    name: input.name || id,
    description: input.description || 'Conversation-created workflow draft.',
    tags: Array.isArray(input.tags) ? input.tags : [],
    ...(input.semver ? { version: input.semver } : {}),
    manifest: {
      kind: 'workflow',
      workflowId: id,
      status: 'draft',
      ...manifest,
    },
    lifecycle: {
      validate: 'workflow.validate',
      run: 'workflow.run',
      publish: 'workflow.publish',
    },
    conversation: {
      sessionId: `capability:workflow:${id}`,
      contextProvider: 'workflowPackageAdapter',
    },
    governance: {
      requiresAdminToPublish: true,
      requiresRealProbeToPublish: false,
      cloudVersioned: true,
    },
  };
  return assertValidCapabilityPackage(pkg);
}
