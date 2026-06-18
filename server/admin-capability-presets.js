import { listAuditLogs } from './auth-store.js';
import {
  exportCapabilityStoreBackup,
  importCapabilityStoreBackup,
  isR2Configured,
  readCapabilityStoreCatalog,
} from './r2-storage-handlers.js';
import { buildImportPreview } from './capability-preset-admin-import.js';

export async function getAdminCapabilityPresetsPayload() {
  const configured = isR2Configured();
  const [catalog, auditResult] = await Promise.all([
    configured ? readCapabilityStoreCatalog() : Promise.resolve([]),
    listAuditLogs({ action: 'admin.capability_preset_publish', limit: 40 }),
  ]);
  const recentPublishes = (auditResult.logs || []).map((row) => ({
    id: row.id,
    at: row.createdAt,
    actorIdentifier: row.actorIdentifier || '',
    presetId: row.meta?.presetId ? String(row.meta.presetId) : '',
    catalogObjectKey: row.meta?.catalogObjectKey ? String(row.meta.catalogObjectKey) : '',
    packObjectKey: row.meta?.packObjectKey ? String(row.meta.packObjectKey) : '',
  }));
  return {
    configured,
    catalog,
    recentPublishes,
  };
}

export async function exportAdminCapabilityPresetsBackup() {
  if (!isR2Configured()) throw new Error('R2 未配置');
  return exportCapabilityStoreBackup();
}

export async function previewAdminCapabilityPresetsImport(backup, mode) {
  if (!isR2Configured()) throw new Error('R2 未配置');
  const onlineCatalog = await readCapabilityStoreCatalog();
  return buildImportPreview(onlineCatalog, backup, mode);
}

export async function runAdminCapabilityPresetsImport(adminUserId, backup, mode) {
  if (!isR2Configured()) throw new Error('R2 未配置');
  return importCapabilityStoreBackup(adminUserId, backup, mode);
}
