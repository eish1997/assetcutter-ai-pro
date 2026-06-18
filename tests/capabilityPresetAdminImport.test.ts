import { describe, expect, it } from 'vitest';

import {
  buildImportPlan,
  buildImportPreview,
  extractPresetIdFromCatalogItem,
  pickMergeWinner,
  validateCapabilityPresetBackup,
  CAPABILITY_PRESET_BACKUP_FORMAT,
} from '../server/capability-preset-admin-import.js';

function catalogItem(presetId: string, version: string) {
  return {
    id: `preset_${presetId}`,
    type: 'capability_presets',
    name: presetId,
    version,
    url: `./presets/${presetId}.json`,
  };
}

function backupPack(presetId: string, label: string) {
  return [{ id: presetId, label, category: 'text_to_text', engine: 'gen_text', instruction: 'x', order: 0 }];
}

function makeBackup(catalog: ReturnType<typeof catalogItem>[], presetIds: string[]) {
  const presets: Record<string, unknown[]> = {};
  for (const pid of presetIds) presets[pid] = backupPack(pid, pid);
  return {
    format: CAPABILITY_PRESET_BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    catalogObjectKey: 'public/capability-store/catalog.json',
    catalog,
    presets,
  };
}

describe('capability preset admin import', () => {
  it('extractPresetIdFromCatalogItem reads preset_ prefix and url', () => {
    expect(extractPresetIdFromCatalogItem(catalogItem('foo', '1'))).toBe('foo');
    expect(extractPresetIdFromCatalogItem({ id: 'preset_bar', url: './presets/bar.json' })).toBe('bar');
  });

  it('pickMergeWinner prefers newer backup version and backup on tie', () => {
    expect(pickMergeWinner(catalogItem('a', '100'), catalogItem('a', '200'))).toBe('backup');
    expect(pickMergeWinner(catalogItem('a', '300'), catalogItem('a', '200'))).toBe('online');
    expect(pickMergeWinner(catalogItem('a', '100'), catalogItem('a', '100'))).toBe('backup');
  });

  it('overwrite plan deletes online-only presets and replaces catalog', () => {
    const online = [catalogItem('keep', '1'), catalogItem('drop', '1')];
    const backup = makeBackup([catalogItem('keep', '2'), catalogItem('new', '1')], ['keep', 'new']);
    const plan = buildImportPlan(online, backup, 'overwrite');
    expect(plan.added).toEqual(['new']);
    expect(plan.updated).toEqual(['keep']);
    expect(plan.removed).toEqual(['drop']);
    expect(plan.presetIdsToDelete).toEqual(['drop']);
    expect(plan.presetsToWrite.map((x) => x.presetId)).toEqual(['keep', 'new']);
    expect(plan.catalog).toHaveLength(2);
  });

  it('merge plan keeps online-only and updates when backup is newer', () => {
    const online = [catalogItem('local', '1'), catalogItem('both', '100')];
    const backup = makeBackup([catalogItem('both', '200'), catalogItem('remote', '1')], ['both', 'remote']);
    const plan = buildImportPlan(online, backup, 'merge');
    expect(plan.added).toEqual(['remote']);
    expect(plan.updated).toEqual(['both']);
    expect(plan.removed).toEqual([]);
    expect(plan.unchanged).toContain('local');
    expect(plan.presetIdsToDelete).toEqual([]);
    expect(plan.presetsToWrite.map((x) => x.presetId)).toEqual(['both', 'remote']);
    expect(plan.catalog.map((x) => extractPresetIdFromCatalogItem(x)).sort()).toEqual(['both', 'local', 'remote']);
  });

  it('merge plan keeps online item when online version is newer', () => {
    const online = [catalogItem('both', '300')];
    const backup = makeBackup([catalogItem('both', '100')], ['both']);
    const plan = buildImportPlan(online, backup, 'merge');
    expect(plan.updated).toEqual([]);
    expect(plan.unchanged).toEqual(['both']);
    expect(plan.presetsToWrite).toHaveLength(0);
    expect(plan.conflicts[0]?.winner).toBe('online');
  });

  it('validateCapabilityPresetBackup rejects invalid format', () => {
    expect(() => validateCapabilityPresetBackup({ format: 'x', catalog: [], presets: {} })).toThrow(/格式不匹配/);
  });

  it('buildImportPreview exposes write/delete counts', () => {
    const online = [catalogItem('drop', '1')];
    const backup = makeBackup([catalogItem('new', '1')], ['new']);
    const preview = buildImportPreview(online, backup, 'overwrite');
    expect(preview.willWriteCount).toBe(1);
    expect(preview.willDeleteCount).toBe(1);
    expect(preview.finalCatalogCount).toBe(1);
  });
});
