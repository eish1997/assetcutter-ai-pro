import { describe, expect, it } from 'vitest';

import type { CustomAppModule } from '../types';
import { mergeCapabilityPresets } from '../services/capabilityPresetStore';
import { mergeCapabilityCloudRecords } from '../services/workspaceUserCloudConfig';

function preset(id: string, label: string, instruction = 'x'): CustomAppModule {
  return {
    id,
    label,
    category: 'text_to_text',
    engine: 'gen_text',
    instruction,
    order: 0,
  };
}

describe('mergeCapabilityPresets server wins on same id', () => {
  it('incoming overwrites existing for same id', () => {
    const local = [preset('a', '本地 A', 'local-only')];
    const server = [preset('a', '服务器 A', 'from-server')];
    const merged = mergeCapabilityPresets(local, server);
    const a = merged.find((p) => p.id === 'a');
    expect(a?.label).toBe('服务器 A');
    expect(a?.instruction).toBe('from-server');
  });

  it('keeps local-only ids not present on server', () => {
    const local = [preset('local-only', '仅本地')];
    const server = [preset('remote-only', '仅远程')];
    const merged = mergeCapabilityPresets(local, server);
    expect(merged.some((p) => p.id === 'local-only')).toBe(true);
    expect(merged.some((p) => p.id === 'remote-only')).toBe(true);
  });
});

describe('mergeCapabilityCloudRecords serverWins', () => {
  it('uses cloud record when serverWins even if local is newer', () => {
    const localList = [preset('p1', '本地较新', 'local')];
    const localRecords = [
      { id: 'p1', updatedAt: 2000, value: preset('p1', '本地较新', 'local') },
    ];
    const cloudRecords = [
      { id: 'p1', updatedAt: 1000, value: preset('p1', '云端', 'cloud') },
    ];
    const { list } = mergeCapabilityCloudRecords(localList, localRecords, cloudRecords, 3000, {
      serverWins: true,
    });
    expect(list.find((p) => p.id === 'p1')?.instruction).toBe('cloud');
  });
});
