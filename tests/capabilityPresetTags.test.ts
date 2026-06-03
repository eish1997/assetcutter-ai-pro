import { describe, expect, it } from 'vitest';
import type { CustomAppModule } from '../types';
import {
  capabilityPresetHasTag,
  collectCapabilityPresetTags,
  normalizeCapabilityPresetTags,
} from '../services/capabilityPresetTags';
import { normalizeCapabilityPreset } from '../services/capabilityPresetStore';

describe('capabilityPresetTags', () => {
  it('normalizeCapabilityPresetTags trims, dedupes, and caps count', () => {
    expect(normalizeCapabilityPresetTags([' 角色 ', '场景', '角色', ''])).toEqual(['角色', '场景']);
    const many = Array.from({ length: 12 }, (_, i) => `tag${i}`);
    expect(normalizeCapabilityPresetTags(many)?.length).toBe(10);
    expect(normalizeCapabilityPresetTags([])).toBeUndefined();
  });

  it('collectCapabilityPresetTags returns sorted unique tags', () => {
    const presets = [
      { tags: ['分镜', '角色'] },
      { tags: ['场景'] },
      { tags: ['角色'] },
    ] as CustomAppModule[];
    expect(collectCapabilityPresetTags(presets)).toEqual(['场景', '分镜', '角色']);
  });

  it('capabilityPresetHasTag matches exact tag', () => {
    const mod = { tags: ['角色'] } as CustomAppModule;
    expect(capabilityPresetHasTag(mod, '角色')).toBe(true);
    expect(capabilityPresetHasTag(mod, '场景')).toBe(false);
  });

  it('normalizeCapabilityPreset persists tags', () => {
    const normalized = normalizeCapabilityPreset(
      {
        id: 'x',
        label: '测试',
        category: 'text_to_image',
        instruction: 'hello',
        tags: [' 标签A ', '标签A', '标签B'],
      },
      0
    );
    expect(normalized.tags).toEqual(['标签A', '标签B']);
  });
});
