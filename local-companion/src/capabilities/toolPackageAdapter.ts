import { assertValidCapabilityPackage, normalizeCapabilityId, type CapabilityPackage } from './capabilityPackages.js';

export type ToolManifestLike = {
  id?: string;
  toolId?: string;
  name?: string;
  label?: string;
  description?: string;
  tags?: unknown;
  semver?: string;
  version?: string;
  manifest?: Record<string, unknown>;
};

export function toolManifestToCapabilityPackage(input: ToolManifestLike): CapabilityPackage {
  const id = normalizeCapabilityId(input.id || input.toolId || input.name || 'tool');
  const name = String(input.name || input.label || id).trim();
  const tags = Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : [];
  return assertValidCapabilityPackage({
    id,
    type: 'tool',
    source: 'draft',
    name,
    description: String(input.description || '').trim(),
    tags,
    version: String(input.semver || input.version || '0.1.0').trim(),
    manifest: {
      ...(input.manifest || {}),
      kind: 'shell_tool',
      toolId: id,
    },
    lifecycle: {
      validate: 'tool.validate',
      install: 'tool.install',
      run: 'tool.run',
      uninstall: 'tool.uninstall',
      publish: 'tool.publish',
    },
    conversation: {
      sessionId: `capability:tool:${id}`,
      contextProvider: 'toolPackageAdapter',
    },
    governance: {
      requiresAdminToPublish: true,
      requiresRealProbeToPublish: false,
      cloudVersioned: true,
    },
  });
}
