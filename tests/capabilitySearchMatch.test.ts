import { describe, expect, it } from 'vitest';

import {
  extractCapabilitySearchKeywords,
  haystackMatchesAnyKeyword,
  keywordsMatchCapabilityModule,
} from '../components/workflow/capabilitySearchMatch';

describe('capabilitySearchMatch', () => {
  it('extracts OR tokens from separators', () => {
    expect(extractCapabilitySearchKeywords('  Foo, BAR  baz ')).toEqual(['foo', 'bar', 'baz']);
    expect(extractCapabilitySearchKeywords('角色、场景')).toEqual(['角色', '场景']);
  });

  it('keeps undelimited CJK as one keyword', () => {
    expect(extractCapabilitySearchKeywords('空间结构')).toEqual(['空间结构']);
  });

  it('haystack matches if any keyword hits', () => {
    const hay = 'general\npreset-1\ncharacter\n'.toLowerCase();
    expect(haystackMatchesAnyKeyword(hay, ['missing', 'character'])).toBe(true);
    expect(haystackMatchesAnyKeyword(hay, ['missing'])).toBe(false);
    expect(haystackMatchesAnyKeyword(hay, [])).toBe(true);
  });

  it('口语整句可反向命中预设名称（整句不含于 hay，但句子里含 label）', () => {
    const mod = {
      label: '生成多视角',
      id: 'mv1',
      category: 'image_to_image',
      instruction: '多视角展开',
    };
    const q = '帮我把图片生成多视角';
    const kws = extractCapabilitySearchKeywords(q);
    expect(kws).toEqual([q.toLowerCase()]);
    expect(keywordsMatchCapabilityModule(kws, mod)).toBe(true);
  });

  it('无需完整预设名：句中含名称子串即可（多视角 → 生成多视角）', () => {
    const mod = {
      label: '生成多视角',
      id: 'multi_view',
      category: 'image_to_image',
      instruction: '',
    };
    const q = '帮我把图片中的物体转成多视角图片';
    const kws = extractCapabilitySearchKeywords(q);
    expect(keywordsMatchCapabilityModule(kws, mod)).toBe(true);
  });
});
