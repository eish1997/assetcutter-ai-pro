import { createCapabilityPackageDraft, readCapabilityPackageDraft } from './capabilityPackageStore.js';
import { activeCapabilityCloudPackage } from './capabilityCloudVersions.js';
import { normalizeCapabilityId, type CapabilityPackage, type CapabilityPackageType } from './capabilityPackages.js';

export type CapabilityTransferBundle = {
  schema: 'assetcutter.capability.transfer';
  version: 1;
  exportedAt: string;
  package: {
    id: string;
    type: CapabilityPackageType;
    name: string;
    description: string;
    tags: string[];
    semver?: string;
    manifest: Record<string, unknown>;
  };
  warnings: string[];
};

const LOCAL_MANIFEST_KEYS = new Set(['inputPath', 'shortcutPath', 'executablePath', 'targetDir', 'scriptsDirs']);

function sanitizeManifestForTransfer(manifest: Record<string, unknown>): { manifest: Record<string, unknown>; warnings: string[] } {
  const out: Record<string, unknown> = {};
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(manifest || {})) {
    if (LOCAL_MANIFEST_KEYS.has(key)) {
      warnings.push(`已移除本机路径字段：${key}`);
      continue;
    }
    out[key] = value;
  }
  return { manifest: out, warnings };
}

function packageForExport(idRaw: string): CapabilityPackage | null {
  return readCapabilityPackageDraft(idRaw) || activeCapabilityCloudPackage(idRaw);
}

export function exportCapabilityPackageTransfer(
  idRaw: string,
): { ok: true; bundle: CapabilityTransferBundle } | { ok: false; error: string; message: string } {
  const pkg = packageForExport(idRaw);
  if (!pkg) return { ok: false, error: 'capability_not_found', message: '能力包不存在。' };
  const manifest = pkg.manifest && typeof pkg.manifest === 'object' ? (pkg.manifest as Record<string, unknown>) : {};
  const sanitized = sanitizeManifestForTransfer(manifest);
  return {
    ok: true,
    bundle: {
      schema: 'assetcutter.capability.transfer',
      version: 1,
      exportedAt: new Date().toISOString(),
      package: {
        id: pkg.id,
        type: pkg.type,
        name: pkg.name,
        description: pkg.description,
        tags: Array.isArray(pkg.tags) ? pkg.tags.map(String).filter(Boolean) : [],
        ...(pkg.version ? { semver: pkg.version } : {}),
        manifest: sanitized.manifest,
      },
      warnings: sanitized.warnings.concat('导入后需要在目标机器重新安装、启动和真实探测。'),
    },
  };
}

export function importCapabilityPackageTransfer(
  bundleRaw: unknown,
): { ok: true; draft: unknown; warnings: string[] } | { ok: false; error: string; message: string } {
  const bundle = bundleRaw && typeof bundleRaw === 'object' ? (bundleRaw as Partial<CapabilityTransferBundle>) : null;
  if (!bundle || bundle.schema !== 'assetcutter.capability.transfer' || bundle.version !== 1) {
    return { ok: false, error: 'invalid_capability_transfer', message: '不是有效的能力包传输文件。' };
  }
  const pkg = bundle.package && typeof bundle.package === 'object' ? bundle.package : null;
  if (!pkg) return { ok: false, error: 'missing_capability_package', message: '传输文件缺少能力包内容。' };
  const type = pkg.type;
  if (type !== 'software_connection' && type !== 'tool' && type !== 'workflow') {
    return { ok: false, error: 'unsupported_capability_type', message: '不支持的能力包类型。' };
  }
  const id = normalizeCapabilityId(pkg.id || pkg.name || type);
  if (!id) return { ok: false, error: 'invalid_capability_id', message: '能力包 ID 无效。' };
  const manifest = pkg.manifest && typeof pkg.manifest === 'object' && !Array.isArray(pkg.manifest) ? pkg.manifest : {};
  const created = createCapabilityPackageDraft({
    id,
    type,
    name: String(pkg.name || id).trim(),
    description: String(pkg.description || '').trim(),
    tags: Array.isArray(pkg.tags) ? pkg.tags.map(String).filter(Boolean) : [],
    semver: pkg.semver,
    manifest: {
      ...manifest,
      importedFromTransfer: true,
      importedAt: new Date().toISOString(),
    },
    createdBy: 'capability-transfer',
  });
  if (!created.ok) {
    return { ok: false, error: created.error, message: created.messages.join('；') || '能力包导入失败。' };
  }
  return {
    ok: true,
    draft: created.draft,
    warnings: Array.isArray(bundle.warnings) ? bundle.warnings.map(String).filter(Boolean) : [],
  };
}
