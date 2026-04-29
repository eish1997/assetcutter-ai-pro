import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomAppModule } from '../types';
import { CAPABILITY_PRESETS_KEY } from '../services/capabilityPresetStore';

const { memory, resetMemory } = vi.hoisted(() => {
  const memory: Record<string, string> = {};
  return {
    memory,
    resetMemory: () => {
      for (const k of Object.keys(memory)) delete memory[k];
    },
  };
});

vi.mock('../services/clientPersist', () => ({
  readLocalString: (key: string) => memory[key] ?? null,
  writeLocalJson: (key: string, value: unknown) => {
    memory[key] = JSON.stringify(value);
  },
  removeLocalKey: vi.fn((key: string) => {
    delete memory[key];
  }),
}));

async function loadStore() {
  return import('../services/capabilityPresetStore');
}

describe('capabilityPreset persistence (mirrors CapabilityPresetSection → saveCapabilityPresets)', () => {
  beforeEach(() => {
    resetMemory();
    vi.resetModules();
  });

  it('companionHostBundle 经 save → load 后保持一致', async () => {
    const { saveCapabilityPresets, loadCapabilityPresets } = await loadStore();

    const custom: CustomAppModule = {
      id: 'ui-hb-roundtrip',
      label: '往返测试宿主包',
      category: 'image_to_image',
      engine: 'gen_image',
      instruction: '说明',
      order: 99,
      companionHostBundle: { dirName: 'my-pack', phase: 'probe' },
    };

    saveCapabilityPresets([custom]);

    const raw = memory[CAPABILITY_PRESETS_KEY];
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { version: number; presets: CustomAppModule[] };
    expect(parsed.version).toBe(4);
    const written = parsed.presets.find((p) => p.id === 'ui-hb-roundtrip');
    expect(written?.companionHostBundle).toEqual({ dirName: 'my-pack', phase: 'probe' });
    expect(written?.engine).toBe('builtin');

    const loaded = loadCapabilityPresets();
    const again = loaded.find((p) => p.id === 'ui-hb-roundtrip');
    expect(again?.companionHostBundle).toEqual({ dirName: 'my-pack', phase: 'probe' });
    expect(again?.engine).toBe('builtin');
  });

  it('清空 companionHostBundle.dirName 后 save → load 不再带该字段', async () => {
    const { saveCapabilityPresets, loadCapabilityPresets } = await loadStore();

    const custom: CustomAppModule = {
      id: 'ui-hb-clear',
      label: '清空宿主包',
      category: 'text_to_text',
      engine: 'gen_text',
      instruction: 'x',
      companionHostBundle: { dirName: 'tmp', phase: 'exec' },
    };

    saveCapabilityPresets([custom]);
    const once = loadCapabilityPresets().find((p) => p.id === 'ui-hb-clear');
    expect(once?.companionHostBundle).toEqual({ dirName: 'tmp' });

    const cleared: CustomAppModule = {
      ...once!,
      companionHostBundle: { dirName: '   ' },
    };
    saveCapabilityPresets(loadCapabilityPresets().map((p) => (p.id === 'ui-hb-clear' ? cleared : p)));

    const twice = loadCapabilityPresets().find((p) => p.id === 'ui-hb-clear');
    expect(twice?.companionHostBundle).toBeUndefined();
  });
});

