import { describe, expect, it, vi } from 'vitest';

const workflowChatMock = vi.hoisted(() => vi.fn());

vi.mock('../services/unifiedAiGateway', () => ({
  workflowChat: workflowChatMock,
}));

import {
  applyShotFieldsPatch,
  compileRedrawPrompt,
  compileShotText,
  listStoryboardParsePresets,
  mergeParseResultIntoRow,
  mergeOptimizeResultIntoRow,
  normalizeOptimizeModelOutput,
  normalizeParseModelOutput,
  parseDurationSecFromParsedValue,
  parseStoryboardRowsBatch,
  pickPrimaryVisualField,
  resolveFieldId,
  resolveStoryboardParseInput,
  rowHasStructuredFieldValues,
  STORYBOARD_PARSE_DEFAULT_PRESET_ID,
} from '../services/storyboardTableParse';
import { createStoryboardTableRow, normalizeStoryboardTableDoc } from '../services/storyboardTableAsset';

describe('storyboardTableParse', () => {
  it('resolveStoryboardParseInput falls back to compiled shotFields when shotRaw empty', () => {
    const catalog = [
      { id: 'f_visual', label: '画面', order: 0, redrawInclude: true, kind: 'text' as const },
    ];
    const row = createStoryboardTableRow({
      shotRaw: '',
      shotFields: { f_visual: '雪夜街道' },
    });
    expect(resolveStoryboardParseInput(row, catalog)).toBe('【画面】雪夜街道');
  });

  it('mergeParseResultIntoRow maps parsed labels onto existing catalog ids', () => {
    const catalog = [
      { id: 'f_visual', label: '画面', order: 0, redrawInclude: true, kind: 'text' as const },
      { id: 'f_dialogue', label: '对白', order: 1, redrawInclude: false, kind: 'text' as const },
    ];
    const row = createStoryboardTableRow({ shotRaw: '推门，你好' });
    const merged = mergeParseResultIntoRow(
      catalog,
      row,
      {
        fields: [
          { label: '画面', value: '推门进屋' },
          { label: '对白', value: '你好呀' },
        ],
      },
      '推门，你好'
    );
    expect(merged.catalog).toHaveLength(2);
    expect(merged.row.shotFields.f_visual).toBe('推门进屋');
    expect(merged.row.shotFields.f_dialogue).toBe('你好呀');
  });

  it('mergeParseResultIntoRow maps 镜头号/时长 to fixed columns', () => {
    const row = createStoryboardTableRow({ shotRaw: 'x' });
    const merged = mergeParseResultIntoRow(
      [],
      row,
      {
        fields: [
          { label: '镜头号', value: 'A-03' },
          { label: '时长', value: '2.5秒' },
          { label: '画面', value: '雪夜' },
        ],
      },
      'raw'
    );
    expect(merged.row.shotNo).toBe('A-03');
    expect(merged.row.durationSec).toBe(2.5);
    expect(merged.catalog).toHaveLength(1);
    expect(merged.catalog[0]?.label).toBe('画面');
    expect(compileShotText(merged.catalog, merged.row.shotFields)).toBe('【画面】雪夜');
  });

  it('parseDurationSecFromParsedValue supports frame count', () => {
    expect(parseDurationSecFromParsedValue('24帧')).toBe(1);
    expect(parseDurationSecFromParsedValue('48帧')).toBe(2);
  });

  it('merges catalog union across parses and keeps untouched fields on re-parse', () => {
    const row = createStoryboardTableRow({ shotRaw: 'x' });
    const first = mergeParseResultIntoRow(
      [],
      row,
      {
        fields: [
          { label: '画面', value: '推门' },
          { label: '对白', value: '你好' },
        ],
      },
      'raw1'
    );
    expect(first.catalog).toHaveLength(2);
    const dialogueId = resolveFieldId(first.catalog, '对白');
    const second = mergeParseResultIntoRow(
      first.catalog,
      first.row,
      {
        fields: [
          { label: '画面', value: '推门进屋' },
          { label: '音效', value: '门轴' },
        ],
      },
      'raw2'
    );
    expect(second.catalog).toHaveLength(3);
    expect(second.row.shotFields[dialogueId]).toBe('你好');
    expect(compileShotText(second.catalog, second.row.shotFields)).toContain('【音效】门轴');
  });

  it('compileRedrawPrompt excludes dialogue-like fields', () => {
    const catalog = [
      {
        id: 'f_visual',
        label: '画面',
        order: 0,
        redrawInclude: true,
        kind: 'text' as const,
      },
      {
        id: 'f_dialogue',
        label: '对白',
        order: 1,
        redrawInclude: false,
        kind: 'text' as const,
      },
    ];
    const row = createStoryboardTableRow({
      shotNo: '03',
      shotFields: { f_visual: '室内', f_dialogue: '台词' },
    });
    const prompt = compileRedrawPrompt(row, catalog);
    expect(prompt).toContain('镜头号 03');
    expect(prompt).toContain('室内');
    expect(prompt).not.toContain('台词');
  });

  it('pickPrimaryVisualField prefers 画面 label', () => {
    const catalog = [
      { id: 'f_a', label: '备注', order: 0, redrawInclude: false, kind: 'text' as const },
      { id: 'f_b', label: '画面', order: 1, redrawInclude: true, kind: 'text' as const },
    ];
    const picked = pickPrimaryVisualField(catalog, { f_a: 'x', f_b: '推门' });
    expect(picked?.value).toBe('推门');
  });

  it('normalizeParseModelOutput strips json fences', () => {
    const out = normalizeParseModelOutput(
      '```json\n{"fields":[{"label":"画面","value":"雪夜"}]}\n```'
    );
    expect(out.fields[0]?.value).toBe('雪夜');
  });

  it('applyShotFieldsPatch keeps shotText in sync', () => {
    const catalog = [
      { id: 'f_visual', label: '画面', order: 0, redrawInclude: true, kind: 'text' as const },
    ];
    const row = applyShotFieldsPatch(createStoryboardTableRow({}), catalog, {
      f_visual: '推门',
    });
    expect(row.shotText).toBe('【画面】推门');
  });

  it('listStoryboardParsePresets always includes builtin when store empty', () => {
    const list = listStoryboardParsePresets([]);
    expect(list.some((p) => p.id === STORYBOARD_PARSE_DEFAULT_PRESET_ID)).toBe(true);
  });

  it('normalize migrates legacy shotText into shotRaw', () => {
    const doc = normalizeStoryboardTableDoc({
      fieldCatalog: [],
      rows: [{ id: '1', index: 0, shotText: '旧文本', shotFields: {} }],
    });
    expect(doc.rows[0]?.shotRaw).toBe('旧文本');
    expect(doc.rows[0]?.shotFields).toEqual({});
    expect(doc.rows[0]?.shotText).toBe('');
  });

  it('mergeOptimizeResultIntoRow updates only returned ids', () => {
    const catalog = [
      { id: 'f_visual', label: '画面', order: 0, redrawInclude: true, kind: 'text' as const },
      { id: 'f_dialogue', label: '对白', order: 1, redrawInclude: false, kind: 'text' as const },
    ];
    const row = createStoryboardTableRow({
      shotFields: { f_visual: '推门', f_dialogue: '你好' },
    });
    const next = mergeOptimizeResultIntoRow(catalog, row, {
      fields: [{ id: 'f_visual', value: '推门进屋' }],
    });
    expect(next.shotFields.f_visual).toBe('推门进屋');
    expect(next.shotFields.f_dialogue).toBe('你好');
  });

  it('mergeOptimizeResultIntoRow preserves dialogue when allowDialogueEdit is false', () => {
    const catalog = [
      { id: 'f_visual', label: '画面', order: 0, redrawInclude: true, kind: 'text' as const },
      { id: 'f_dialogue', label: '对白', order: 1, redrawInclude: false, kind: 'text' as const },
    ];
    const row = createStoryboardTableRow({
      shotFields: { f_visual: '推门', f_dialogue: '你好' },
    });
    const next = mergeOptimizeResultIntoRow(
      catalog,
      row,
      {
        fields: [
          { id: 'f_visual', value: '推门进屋' },
          { id: 'f_dialogue', value: '被模型改了' },
        ],
      },
      { allowDialogueEdit: false }
    );
    expect(next.shotFields.f_visual).toBe('推门进屋');
    expect(next.shotFields.f_dialogue).toBe('你好');
  });

  it('rowHasStructuredFieldValues requires non-empty catalog values', () => {
    const catalog = [
      { id: 'f_visual', label: '画面', order: 0, redrawInclude: true, kind: 'text' as const },
    ];
    expect(rowHasStructuredFieldValues(catalog, { shotFields: {} })).toBe(false);
    expect(rowHasStructuredFieldValues(catalog, { shotFields: { f_visual: 'x' } })).toBe(true);
  });

  it('parseStoryboardRowsBatch unions catalog in row order after parallel LLM calls', async () => {
    workflowChatMock.mockImplementation(async (contents: { role: string; parts: { text: string }[] }[]) => {
      const text = contents[0]?.parts?.[0]?.text ?? '';
      if (text.includes('\n\nr1')) {
        return JSON.stringify({
          fields: [
            { label: '画面', value: 'A' },
            { label: '对白', value: 'd1' },
          ],
        });
      }
      return JSON.stringify({
        fields: [
          { label: '画面', value: 'B' },
          { label: '音效', value: 'sfx' },
        ],
      });
    });

    const preset = { id: 'p', label: 't', category: 'text_to_text' as const, instruction: '' };
    const rows = [
      createStoryboardTableRow({ id: 'a', shotRaw: 'r1' }),
      createStoryboardTableRow({ id: 'b', shotRaw: 'r2' }),
    ];

    const batch = await parseStoryboardRowsBatch(rows, [], preset, {}, { concurrency: 2 });
    workflowChatMock.mockReset();

    expect(batch.catalog).toHaveLength(3);
    expect(batch.results.every((r) => r.ok)).toBe(true);
    const dialogueId = resolveFieldId(batch.catalog, '对白');
    expect(batch.rows[0]?.shotFields[dialogueId]).toBe('d1');
    const sfxId = resolveFieldId(batch.catalog, '音效');
    expect(batch.rows[1]?.shotFields[sfxId]).toBe('sfx');
  });

  it('normalizeOptimizeModelOutput rejects output without valid ids', () => {
    const catalog = [
      { id: 'f_visual', label: '画面', order: 0, redrawInclude: true, kind: 'text' as const },
    ];
    expect(() =>
      normalizeOptimizeModelOutput(
        JSON.stringify({ fields: [{ id: 'f_unknown', value: 'x' }] }),
        catalog
      )
    ).toThrow();
  });
});
