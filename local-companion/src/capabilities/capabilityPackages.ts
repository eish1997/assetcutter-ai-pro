export type CapabilityPackageType = 'software_connection' | 'tool' | 'workflow';
export type CapabilityPackageSource = 'builtin' | 'draft' | 'cloud';

export type CapabilityPackage = {
  id: string;
  type: CapabilityPackageType;
  source: CapabilityPackageSource;
  name: string;
  description: string;
  tags: string[];
  version?: string;
  manifest: Record<string, unknown>;
  lifecycle: {
    validate?: string;
    install?: string;
    run?: string;
    probe?: string;
    uninstall?: string;
    publish?: string;
  };
  conversation: {
    sessionId: string;
    contextProvider: string;
  };
  governance: {
    requiresAdminToPublish: boolean;
    requiresRealProbeToPublish: boolean;
    cloudVersioned: boolean;
  };
};

export type CapabilityValidationResult = {
  ok: boolean;
  errors: string[];
};

const TYPES = new Set<CapabilityPackageType>(['software_connection', 'tool', 'workflow']);
const SOURCES = new Set<CapabilityPackageSource>(['builtin', 'draft', 'cloud']);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeCapabilityId(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function validateCapabilityPackage(pkg: unknown): CapabilityValidationResult {
  const errors: string[] = [];
  if (!isObject(pkg)) return { ok: false, errors: ['capability_package_required'] };
  const id = String(pkg.id || '').trim();
  if (!/^[a-z][a-z0-9._-]{1,79}$/.test(id)) errors.push('invalid_id');
  if (!TYPES.has(pkg.type as CapabilityPackageType)) errors.push('invalid_type');
  if (!SOURCES.has(pkg.source as CapabilityPackageSource)) errors.push('invalid_source');
  if (!nonEmptyString(pkg.name)) errors.push('name_required');
  if (!isObject(pkg.manifest)) errors.push('manifest_required');
  if (!isObject(pkg.lifecycle)) errors.push('lifecycle_required');
  if (!isObject(pkg.conversation)) {
    errors.push('conversation_required');
  } else {
    if (!nonEmptyString(pkg.conversation.sessionId)) errors.push('conversation_session_required');
    if (!nonEmptyString(pkg.conversation.contextProvider)) errors.push('conversation_context_provider_required');
  }
  if (!isObject(pkg.governance)) {
    errors.push('governance_required');
  } else {
    for (const key of ['requiresAdminToPublish', 'requiresRealProbeToPublish', 'cloudVersioned']) {
      if (typeof pkg.governance[key] !== 'boolean') errors.push(`governance_${key}_required`);
    }
  }
  if (pkg.tags != null && !Array.isArray(pkg.tags)) errors.push('tags_must_be_array');
  return { ok: errors.length === 0, errors };
}

export function assertValidCapabilityPackage(pkg: CapabilityPackage): CapabilityPackage {
  const result = validateCapabilityPackage(pkg);
  if (!result.ok) throw new Error(result.errors.join(','));
  return pkg;
}
