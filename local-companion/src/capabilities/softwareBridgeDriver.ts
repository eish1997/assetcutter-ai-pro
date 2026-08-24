import type { CapabilityPackage } from './capabilityPackages.js';
import type { ConnectionStrategy } from './connectionStrategy.js';
import type { LocalSoftwareVersion } from './connectionLocalVersions.js';

export type SoftwareBridgeMatchInput = {
  packageId: string;
  name: string;
  manifest: Record<string, unknown>;
  package: CapabilityPackage;
};

export type SoftwareBridgeLifecycleInput = {
  targetDir?: string;
  scriptsDirs?: string[];
  port?: number;
  executablePath?: string;
  targetId?: string;
  versionId?: string;
  localVersionId?: string;
  localVersion?: LocalSoftwareVersion;
};

export type SoftwareBridgeLifecycleSuccess = {
  ok: true;
  message?: string;
  [key: string]: unknown;
};

export type SoftwareBridgeLifecycleFailure = {
  ok: false;
  error: string;
  message: string;
  [key: string]: unknown;
};

export type SoftwareBridgeLifecycleResult = SoftwareBridgeLifecycleSuccess | SoftwareBridgeLifecycleFailure;

export type SoftwareBridgeDriver = {
  id: string;
  label: string;
  match(input: SoftwareBridgeMatchInput): boolean;
  getStatus(input?: SoftwareBridgeLifecycleInput): unknown | Promise<unknown>;
  install(input?: SoftwareBridgeLifecycleInput): SoftwareBridgeLifecycleResult | Promise<SoftwareBridgeLifecycleResult>;
  probe(input?: SoftwareBridgeLifecycleInput): SoftwareBridgeLifecycleResult | Promise<SoftwareBridgeLifecycleResult>;
  uninstall(input?: SoftwareBridgeLifecycleInput): SoftwareBridgeLifecycleResult | Promise<SoftwareBridgeLifecycleResult>;
  normalizeInstallInput?(input?: SoftwareBridgeLifecycleInput): SoftwareBridgeLifecycleInput;
  strategies?(input: SoftwareBridgeMatchInput): ConnectionStrategy[];
};

export function buildSoftwareBridgeMatchInput(pkg: CapabilityPackage): SoftwareBridgeMatchInput {
  return {
    packageId: pkg.id,
    name: pkg.name,
    manifest: pkg.manifest && typeof pkg.manifest === 'object' ? (pkg.manifest as Record<string, unknown>) : {},
    package: pkg,
  };
}
