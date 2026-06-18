import { describe, expect, it } from 'vitest';

import { buildCloudPresetIdSet, isCloudCapabilityPreset, matchesCapabilitySidebarOriginFilter, presetIdFromStorePackId } from '../services/capabilityPresetCloudOrigin';
import type { CustomAppModule } from '../types';

describe('capabilityPresetCloudOrigin', () => {
  it('presetIdFromStorePackId strips preset_ prefix', () => {
    expect(presetIdFromStorePackId('preset_foo')).toBe('foo');
    expect(presetIdFromStorePackId('other')).toBeNull();
  });

  it('buildCloudPresetIdSet collects remote catalog preset ids', () => {
    const preset: CustomAppModule = {
      id: 'remote_a',
      label: 'A',
      category: 'text_to_text',
      engine: 'gen_text',
      instruction: 'x',
      order: 0,
    };
    const set = buildCloudPresetIdSet([{ preset, pack: { id: 'preset_remote_a', type: 'capability_presets', name: 'A', version: '1', url: './presets/remote_a.json' } }]);
    expect(isCloudCapabilityPreset('remote_a', set)).toBe(true);
    expect(isCloudCapabilityPreset('local_only', set)).toBe(false);
    expect(matchesCapabilitySidebarOriginFilter('remote_a', 'cloud', set)).toBe(true);
    expect(matchesCapabilitySidebarOriginFilter('local_only', 'cloud', set)).toBe(false);
    expect(matchesCapabilitySidebarOriginFilter('local_only', 'mine', set)).toBe(true);
    expect(matchesCapabilitySidebarOriginFilter('remote_a', 'mine', set)).toBe(false);
  });
});
