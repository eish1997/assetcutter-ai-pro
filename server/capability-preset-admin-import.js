export const CAPABILITY_PRESET_BACKUP_FORMAT = 'assetcutter-capability-presets-backup';

export function extractPresetIdFromCatalogItem(item) {
  if (!item || typeof item !== 'object') return '';
  const catalogId = String(item.id || '').trim();
  if (catalogId.startsWith('preset_')) return catalogId.slice('preset_'.length);
  const url = String(item.url || '').trim();
  const m = url.match(/^\.\/presets\/([^/.]+)\.json$/i);
  if (m?.[1]) return m[1];
  return catalogId.replace(/^preset_/, '');
}

export function catalogItemVersion(item) {
  const v = String(item?.version || '').trim();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function pickMergeWinner(onlineItem, backupItem) {
  const onlineV = catalogItemVersion(onlineItem);
  const backupV = catalogItemVersion(backupItem);
  if (backupV >= onlineV) return 'backup';
  return 'online';
}

export function indexCatalogByPresetId(catalog) {
  const map = new Map();
  for (const item of catalog || []) {
    if (!item || typeof item !== 'object') continue;
    const pid = extractPresetIdFromCatalogItem(item);
    if (!pid) continue;
    map.set(pid, item);
  }
  return map;
}

function firstPresetFromPack(pack) {
  if (Array.isArray(pack)) return pack[0] || null;
  if (pack && typeof pack === 'object') return pack;
  return null;
}

export function validateCapabilityPresetBackup(backup) {
  if (!backup || typeof backup !== 'object') throw new Error('备份无效');
  if (backup.format !== CAPABILITY_PRESET_BACKUP_FORMAT) throw new Error('备份格式不匹配');
  if (!Array.isArray(backup.catalog)) throw new Error('备份缺少 catalog');
  if (!backup.presets || typeof backup.presets !== 'object') throw new Error('备份缺少 presets');
  for (const item of backup.catalog) {
    const pid = extractPresetIdFromCatalogItem(item);
    if (!pid) throw new Error('catalog 项缺少有效 preset id');
    const pack = backup.presets[pid];
    const preset = firstPresetFromPack(pack);
    if (!preset || typeof preset !== 'object') throw new Error(`备份缺少 preset 包：${pid}`);
    if (!String(preset.id || '').trim() || !String(preset.label || '').trim()) {
      throw new Error(`preset ${pid} 缺少 id 或 label`);
    }
  }
}

export function buildImportPlan(onlineCatalog, backup, mode) {
  validateCapabilityPresetBackup(backup);
  const normalizedMode = String(mode || '').trim();
  if (normalizedMode !== 'overwrite' && normalizedMode !== 'merge') throw new Error('mode 无效');

  const online = Array.isArray(onlineCatalog) ? onlineCatalog : [];
  const onlineMap = indexCatalogByPresetId(online);
  const backupMap = indexCatalogByPresetId(backup.catalog);

  const added = [];
  const updated = [];
  const removed = [];
  const unchanged = [];
  const conflicts = [];
  const presetsToWrite = [];
  const presetIdsToDelete = [];
  let catalog = [];

  if (normalizedMode === 'overwrite') {
    for (const [pid, backupItem] of backupMap) {
      const preset = firstPresetFromPack(backup.presets[pid]);
      presetsToWrite.push({ presetId: pid, preset, catalogItem: backupItem });
      if (onlineMap.has(pid)) updated.push(pid);
      else added.push(pid);
    }
    for (const pid of onlineMap.keys()) {
      if (!backupMap.has(pid)) {
        presetIdsToDelete.push(pid);
        removed.push(pid);
      }
    }
    catalog = [...backup.catalog];
  } else {
    const mergedById = new Map();

    for (const [pid, onlineItem] of onlineMap) {
      if (!backupMap.has(pid)) {
        unchanged.push(pid);
        mergedById.set(pid, onlineItem);
      }
    }

    for (const [pid, backupItem] of backupMap) {
      const preset = firstPresetFromPack(backup.presets[pid]);
      const onlineItem = onlineMap.get(pid);
      if (!onlineItem) {
        added.push(pid);
        mergedById.set(pid, backupItem);
        presetsToWrite.push({ presetId: pid, preset, catalogItem: backupItem });
        continue;
      }
      const winner = pickMergeWinner(onlineItem, backupItem);
      conflicts.push({
        id: pid,
        onlineVersion: String(onlineItem.version || ''),
        backupVersion: String(backupItem.version || ''),
        winner,
      });
      if (winner === 'backup') {
        updated.push(pid);
        mergedById.set(pid, backupItem);
        presetsToWrite.push({ presetId: pid, preset, catalogItem: backupItem });
      } else {
        unchanged.push(pid);
        mergedById.set(pid, onlineItem);
      }
    }

    const seen = new Set();
    for (const item of backup.catalog) {
      const pid = extractPresetIdFromCatalogItem(item);
      const merged = mergedById.get(pid);
      if (!pid || !merged || seen.has(pid)) continue;
      catalog.push(merged);
      seen.add(pid);
    }
    for (const item of online) {
      const pid = extractPresetIdFromCatalogItem(item);
      const merged = mergedById.get(pid);
      if (!pid || !merged || seen.has(pid)) continue;
      catalog.push(merged);
      seen.add(pid);
    }
  }

  return {
    mode: normalizedMode,
    added,
    updated,
    removed,
    unchanged,
    conflicts,
    presetsToWrite,
    presetIdsToDelete,
    catalog,
  };
}

export function buildImportPreview(onlineCatalog, backup, mode) {
  const plan = buildImportPlan(onlineCatalog, backup, mode);
  return {
    mode: plan.mode,
    added: plan.added,
    updated: plan.updated,
    removed: plan.removed,
    unchanged: plan.unchanged,
    conflicts: plan.conflicts,
    totalBackup: plan.added.length + plan.updated.length + plan.unchanged.filter((id) => backup.presets[id]).length,
    willWriteCount: plan.presetsToWrite.length,
    willDeleteCount: plan.presetIdsToDelete.length,
    finalCatalogCount: plan.catalog.length,
  };
}
