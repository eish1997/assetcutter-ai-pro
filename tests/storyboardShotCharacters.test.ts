import { describe, expect, it } from 'vitest';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import {
  ensureShotCharacterFieldOnRow,
  extractSpeakerFromStoryboardLine,
  inferCharacterNamesFromFieldItems,
  inferCharacterNamesFromShotRow,
  looksLikeCharacterName,
  parseCharacterNamesFromListText,
  STORYBOARD_SHOT_CHARACTER_FIELD_LABEL,
} from '../services/storyboardShotCharacters';

const catalog: StoryboardParseFieldDef[] = [
  { id: 'f_dialogue', label: '对白', order: 1, redrawInclude: false, kind: 'text' },
  { id: 'f_visual', label: '画面内容', order: 2, redrawInclude: true, kind: 'multiline' },
  { id: 'f_costume', label: '服化道建议', order: 3, redrawInclude: true, kind: 'text' },
  { id: 'f_light', label: '光影设计', order: 4, redrawInclude: true, kind: 'text' },
];

function mockRow(shotFields: Record<string, string>): StoryboardTableRow {
  return {
    id: 'row-1',
    index: 0,
    shotNo: 'SC01',
    locked: false,
    shotFields,
    shotText: '',
  };
}

describe('looksLikeCharacterName', () => {
  it('accepts typical person names', () => {
    expect(looksLikeCharacterName('张三')).toBe(true);
    expect(looksLikeCharacterName('叶不凡')).toBe(true);
  });

  it('rejects props and scene descriptors', () => {
    expect(looksLikeCharacterName('手机')).toBe(false);
    expect(looksLikeCharacterName('暖黄城市灯光')).toBe(false);
  });
});

describe('extractSpeakerFromStoryboardLine', () => {
  it('reads colon speaker tags', () => {
    expect(extractSpeakerFromStoryboardLine('张三：你好')).toBe('张三');
  });

  it('skips narration labels', () => {
    expect(extractSpeakerFromStoryboardLine('旁白：城市夜景')).toBeNull();
  });
});

describe('inferCharacterNamesFromFieldItems', () => {
  it('uses dialogue speakers and ignores costume/lighting columns', () => {
    const names = inferCharacterNamesFromFieldItems([
      { label: '对白', value: '张三：你好\n李四：再见' },
      { label: '服化道建议', value: '手机、暖黄城市灯光' },
      { label: '光影设计', value: '暖黄城市灯光' },
    ]);
    expect(names).toEqual(['张三', '李四']);
  });

  it('does not treat lighting copy as character names', () => {
    expect(
      inferCharacterNamesFromFieldItems([
        { label: '画面内容', value: '清北市夜景，万家灯火，高楼林立' },
        { label: '服化道建议', value: '手机' },
        { label: '光影设计', value: '暖黄城市灯光' },
      ])
    ).toEqual([]);
  });
});

describe('inferCharacterNamesFromShotRow', () => {
  it('reads from shot character column when present', () => {
    const cat: StoryboardParseFieldDef[] = [
      ...catalog,
      { id: 'f_shot_char', label: STORYBOARD_SHOT_CHARACTER_FIELD_LABEL, order: 5, redrawInclude: false, kind: 'text' },
    ];
    expect(
      inferCharacterNamesFromShotRow(
        mockRow({ f_shot_char: '小明、小红', f_dialogue: '张三：你好' }),
        cat
      )
    ).toEqual(['小明', '小红']);
  });
});

describe('ensureShotCharacterFieldOnRow', () => {
  it('adds shot character field when inferred from dialogue', () => {
    const row = mockRow({ f_dialogue: '张三：台词' });
    const result = ensureShotCharacterFieldOnRow(catalog, row, [
      { label: '对白', value: '张三：台词' },
    ]);
    const def = result.catalog.find((f) => f.label === STORYBOARD_SHOT_CHARACTER_FIELD_LABEL);
    expect(def).toBeTruthy();
    expect(result.row.shotFields[def!.id]).toBe('张三');
  });
});

describe('parseCharacterNamesFromListText', () => {
  it('filters non-character tokens', () => {
    expect(parseCharacterNamesFromListText('张三、手机、李四')).toEqual(['张三', '李四']);
  });
});
