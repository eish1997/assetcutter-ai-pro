export type HostPrimitiveMetadata = {
  tier: 'primitive' | 'composed';
  dependsOn: string[];
  probeKind: string;
  hostId: string;
  hostPrimitiveId: string;
  hostPrimitiveLabel: string;
};

const DEFAULT_METADATA: HostPrimitiveMetadata = {
  tier: 'composed',
  dependsOn: [],
  probeKind: 'bridge_connected',
  hostId: '',
  hostPrimitiveId: '',
  hostPrimitiveLabel: '',
};

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizeHostPrimitiveMetadata(manifest: Record<string, unknown> | null | undefined): HostPrimitiveMetadata {
  const row = asRecord(manifest);
  const hostPrimitive = asRecord(row.hostPrimitive);
  const tierRaw = cleanString(row.tier || hostPrimitive.tier || row.hostPrimitiveTier);
  const tier = tierRaw === 'primitive' ? 'primitive' : 'composed';
  const dependsOn = Array.isArray(row.dependsOn)
    ? row.dependsOn.map(String).filter(Boolean)
    : Array.isArray(hostPrimitive.dependsOn)
      ? hostPrimitive.dependsOn.map(String).filter(Boolean)
      : [];
  return {
    tier,
    dependsOn,
    probeKind: cleanString(row.probeKind || hostPrimitive.probeKind) || 'bridge_connected',
    hostId: cleanString(row.hostId || row.softwareId || hostPrimitive.hostId),
    hostPrimitiveId: cleanString(row.hostPrimitiveId || hostPrimitive.id),
    hostPrimitiveLabel: cleanString(row.hostPrimitiveLabel || hostPrimitive.label),
  };
}

export function validateHostPrimitiveMetadata(input: unknown): HostPrimitiveMetadata {
  const manifest = asRecord(input);
  const meta = normalizeHostPrimitiveMetadata(manifest);
  if (meta.tier === 'primitive' && !meta.hostPrimitiveId && !cleanString(manifest.id)) {
    throw new Error('primitive tier requires hostPrimitiveId or id');
  }
  if (meta.dependsOn.some((dep) => !dep.startsWith('host.') && !dep.startsWith('tool.') && !dep.startsWith('workflow.'))) {
    // Allow free-form dependsOn during migration; composed tools may reference script names.
  }
  return meta;
}

export function hostTagFromManifest(manifest: Record<string, unknown> | null | undefined): string {
  const meta = normalizeHostPrimitiveMetadata(manifest);
  const hostId = meta.hostId || cleanString(manifest?.hostId);
  return hostId ? `host:${hostId}` : '';
}

export function composedToolReferencesPrimitive(manifest: Record<string, unknown> | null | undefined): boolean {
  const meta = normalizeHostPrimitiveMetadata(manifest);
  return meta.tier === 'composed' && meta.dependsOn.some((dep) => dep.startsWith('host.'));
}

export const HOST_PRIMITIVE_DEFAULT_TIER = DEFAULT_METADATA.tier;
