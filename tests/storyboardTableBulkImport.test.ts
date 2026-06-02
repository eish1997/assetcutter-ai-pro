import { describe, expect, it } from 'vitest';
import { createStoryboardTableRow } from '../services/storyboardTableAsset';
import type { StoryboardParseFieldDef } from '../types';
import {
  rowHasStoryboardBulkImportBaseline,
  applyStoryboardBulkImport,
  buildDuplicateStoryboardShotGroups,
  detectStoryboardBulkDelimiter,
  findStoryboardShotCollisionLines,
  parseStoryboardBulkText,
  resolveStoryboardBulkLineCharRange,
  splitStoryboardBulkSourceLines,
} from '../services/storyboardTableBulkImport';

const SAMPLE_PIPE = `镜头号 | 景别 | 角度 | 运镜 | 时长 | 画面内容 | 对白 | 服化道建议 | 光影设计
SC01_SH001 | 大远景 | 平视 | 固定 | 3.0s | 清北市夜景全景，万家灯火，高楼林立 | - | - | 暖黄色城市灯光
SC01_SH002 | 远景 | 俯视 | 缓慢摇 | 2.5s | 凯丰药业大厦外观，落地窗透出微光 | - | - | 冷调环境光
SC01_SH003 | 全景 | 平视 | 推 | 2.0s | 办公室内景，昏暗光线，奢华陈设 | - | 黑色职业套装 | 低照度，侧光勾勒轮廓`;

describe('storyboardTableBulkImport', () => {
  it('detects pipe delimiter for storyboard text', () => {
    expect(detectStoryboardBulkDelimiter(SAMPLE_PIPE, 'pipe')).toBe('|');
  });

  it('parses pipe-delimited storyboard sample', () => {
    const parsed = parseStoryboardBulkText(SAMPLE_PIPE, 'pipe');
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]?.shotNo).toBe('SC01_SH001');
    expect(parsed.rows[0]?.durationSec).toBe(3);
    expect(parsed.rows[2]?.fields.some((field) => field.label === '服化道建议')).toBe(true);
    expect(parsed.rows[2]?.fields.find((field) => field.label === '画面内容')?.value).toContain(
      '办公室内景'
    );
  });

  it('parses tsv table rows', () => {
    const tsv = `镜头号\t景别\t时长\t画面内容
A01\t远景\t2s\t城市夜景`;
    const parsed = parseStoryboardBulkText(tsv, 'tsv');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.shotNo).toBe('A01');
    expect(parsed.rows[0]?.durationSec).toBe(2);
  });

  it('applies import into storyboard rows and catalog', () => {
    const parsed = parseStoryboardBulkText(SAMPLE_PIPE, 'pipe');
    const { catalog, rows } = applyStoryboardBulkImport([], [], parsed.rows, 'replace');
    expect(rows).toHaveLength(3);
    expect(catalog.some((field) => field.label === '景别')).toBe(true);
    expect(rows[1]?.shotNo).toBe('SC01_SH002');
    expect(rows[1]?.shotFields[catalog.find((field) => field.label === '景别')!.id]).toBe('远景');
  });

  it('append mode updates existing rows by shot number instead of duplicating', () => {
    const first = parseStoryboardBulkText(
      `镜号 | 画面内容
001 | 旧画面
003 | C`,
      'pipe'
    );
    const { catalog, rows: initialRows } = applyStoryboardBulkImport([], [], first.rows, 'replace');
    const second = parseStoryboardBulkText(
      `镜号 | 画面内容
001 | 新画面
002 | B
003 | C2`,
      'pipe'
    );
    const { rows } = applyStoryboardBulkImport(catalog, initialRows, second.rows, 'append');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.id).toBe(initialRows[0]?.id);
    expect(rows[0]?.shotFields[catalog.find((field) => field.label === '画面内容')!.id]).toBe('新画面');
    expect(rows.map((row) => row.shotNo)).toEqual(['001', '002', '003']);
    expect(rows[1]?.shotNo).toBe('002');
  });

  it('recognizes header with 音效 column name', () => {
    const text = `音效 | 时长 | 画面
-10dB (窗外城市远景的低频嗡鸣) | 24帧 | 城市夜景`;
    const parsed = parseStoryboardBulkText(text, 'pipe');
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.durationSec).toBe(1);
    expect(parsed.rows[0]?.fields.find((field) => field.label === '音效')?.value).toContain('-10dB');
  });

  it('infers columns when pasted without header row', () => {
    const text = `-10dB (窗外城市远景的低频嗡鸣) | 24帧 | 城市夜景全景
-6dB (室内空调低频) | 48帧 | 办公室内景`;
    const parsed = parseStoryboardBulkText(text, 'pipe');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.headers.some((header) => header === '音效' || header === '时长')).toBe(true);
    expect(parsed.rows[0]?.durationSec).toBe(1);
    expect(parsed.rows[1]?.durationSec).toBe(2);
  });

  it('accepts short generic column headers', () => {
    const text = `编号 | 景 | 内容
01 | 远景 | 城市夜景`;
    const parsed = parseStoryboardBulkText(text, 'pipe');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.fields.some((field) => field.label === '景' && field.value === '远景')).toBe(true);
  });

  it('skips act titles and meta rows when shot column is present', () => {
    const text = `镜号 | 画面内容
018 | 镜头 A
019 | 镜头 B
020 | 镜头 C
第二幕：碧玉破空 (021 - 048镜，共81镜) | -
呼吸韵律：突袭处的短镜压到1.0s以内 | -
镜号 | 画面描述、角色表演与3D流体特效（直接喂给AI）
021 | 镜头 D
022 | 镜头 E`;
    const parsed = parseStoryboardBulkText(text, 'pipe');
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.rows.map((row) => row.shotNo)).toEqual(['018', '019', '020', '021', '022']);
  });

  it('reports duplicate shot numbers in parsed rows', () => {
    const text = `镜号 | 画面内容
018 | A
018 | B
021 | C`;
    const parsed = parseStoryboardBulkText(text, 'pipe');
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.duplicateShotNos).toEqual(['018']);
    expect(parsed.duplicateShotGroups).toHaveLength(1);
    expect(parsed.duplicateShotGroups[0]?.lines.map((line) => line.lineNo)).toEqual([2, 3]);
  });

  it('buildDuplicateStoryboardShotGroups treats 018 and 018 as same key', () => {
    const groups = buildDuplicateStoryboardShotGroups([
      { lineNo: 2, shotNo: '018', preview: 'a' },
      { lineNo: 5, shotNo: ' 018 ', preview: 'b' },
      { lineNo: 6, shotNo: '021', preview: 'c' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.shotNo).toBe('018');
    expect(groups[0]?.lines).toHaveLength(2);
  });

  it('findStoryboardShotCollisionLines marks incoming rows that hit existing table', () => {
    const refs = findStoryboardShotCollisionLines(
      [{ shotNo: '018' }],
      [
        { lineNo: 2, shotNo: '018', preview: 'dup' },
        { lineNo: 3, shotNo: '019', preview: 'ok' },
      ]
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.lineNo).toBe(2);
  });

  it('line errors include preview text and skip blank lines in numbering', () => {
    const text = `镜号 | 画面内容

018 | ok

说明行没有镜号 | 只有说明
019 | ok`;
    const parsed = parseStoryboardBulkText(text, 'pipe');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.lineErrors).toHaveLength(1);
    expect(parsed.lineErrors[0]?.lineNo).toBe(3);
    expect(parsed.lineErrors[0]?.preview).toContain('说明行没有镜号');
    expect(parsed.errors[0]).toContain('第 3 行');
    expect(parsed.errors[0]).toContain('说明行没有镜号');
  });

  it('splitStoryboardBulkSourceLines tracks char ranges across blank lines', () => {
    const text = '018 | a\n\n019 | b';
    const lines = splitStoryboardBulkSourceLines(text);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.lineNo).toBe(1);
    expect(lines[1]?.lineNo).toBe(2);
    expect(text.slice(lines[1]!.charStart, lines[1]!.charEnd)).toBe('019 | b');
  });

  it('resolveStoryboardBulkLineCharRange selects full physical line', () => {
    const text = '  018 | a  \n\n019 | b';
    const range = resolveStoryboardBulkLineCharRange(text, 1);
    expect(range).not.toBeNull();
    expect(text.slice(range!.charStart, range!.charEnd)).toBe('  018 | a  ');
  });

  it('parses tagged freeform line with erroneous column prefix', () => {
    const text = `镜号 | 画面内容
音效|131中景 3.5s 【对角线切入】相机跟随。【画面描述】杀气复苏。`;
    const parsed = parseStoryboardBulkText(text, 'pipe');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.shotNo).toBe('131');
    expect(parsed.rows[0]?.durationSec).toBe(3.5);
    expect(parsed.rows[0]?.shotRaw).toContain('131中景 3.5s');
    expect(
      parsed.rows[0]?.fields.find((field) => field.label === '3D虚拟机位运镜与构图描述')?.value
    ).toContain('对角线切入');
    expect(
      parsed.rows[0]?.fields.find((field) => field.label === '画面描述、角色表演与3D流体特效')?.value
    ).toBe('杀气复苏。');
  });

  it('append merge does not grow field catalog with random tags', () => {
    const catalog: StoryboardParseFieldDef[] = [
      { id: 'f_scale', label: '景别', order: 0, redrawInclude: true, kind: 'text' },
      {
        id: 'f_cam',
        label: '3D虚拟机位运镜与构图描述',
        order: 1,
        redrawInclude: true,
        kind: 'multiline',
      },
      {
        id: 'f_visual',
        label: '画面描述、角色表演与3D流体特效',
        order: 2,
        redrawInclude: true,
        kind: 'multiline',
      },
      { id: 'f_dialogue', label: '台词同步', order: 3, redrawInclude: false, kind: 'text' },
    ];
    const initialRows = [
      createStoryboardTableRow({ shotNo: '131', shotFields: { f_visual: '旧' } }, 0),
    ];
    initialRows[0]!.shotFields = { f_visual: '旧' };
    const incoming = parseStoryboardBulkText(
      `131 | 【动态阴影平移】平移。【轴线飞跃】飞跃。【画面描述】新画面`,
      'pipe'
    );
    const { catalog: nextCatalog, rows } = applyStoryboardBulkImport(
      catalog,
      initialRows,
      incoming.rows,
      'append'
    );
    expect(nextCatalog).toHaveLength(4);
    expect(nextCatalog.map((field) => field.label)).toEqual(catalog.map((field) => field.label));
    expect(rows[0]?.shotFields.f_cam).toContain('动态阴影平移');
    expect(rows[0]?.shotFields.f_visual).toBe('新画面');
  });

  it('rowHasStoryboardBulkImportBaseline treats frame-only rows as existing content', () => {
    const row = createStoryboardTableRow(
      { shotNo: '131', frameImage: 'data:image/png;base64,abc' },
      0
    );
    expect(rowHasStoryboardBulkImportBaseline(row)).toBe(true);
  });

  it('append merge preserves split frame images when importing text', () => {
    const existing = [
      createStoryboardTableRow(
        {
          id: 'row-131',
          shotNo: '131',
          frameImage: 'data:image/png;base64,split',
          frameImageCompanionKey: 'companion-key-131',
        },
        0
      ),
    ];
    const incoming = parseStoryboardBulkText(
      `镜号 | 画面
131 | 新画面描述`,
      'pipe'
    );
    const { rows } = applyStoryboardBulkImport([], existing, incoming.rows, 'append');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('row-131');
    expect(rows[0]?.frameImage).toBe('data:image/png;base64,split');
    expect(rows[0]?.frameImageCompanionKey).toBe('companion-key-131');
    expect(rows[0]?.shotRaw).toContain('131');
  });

  it('append merge matches padded shot numbers and keeps frame image', () => {
    const existing = [
      createStoryboardTableRow(
        {
          id: 'row-padded',
          shotNo: '0131',
          frameImage: 'data:image/png;base64,split',
        },
        0
      ),
    ];
    const incoming = parseStoryboardBulkText(
      `镜号 | 画面
131 | 描述`,
      'pipe'
    );
    const { rows } = applyStoryboardBulkImport([], existing, incoming.rows, 'append');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('row-padded');
    expect(rows[0]?.frameImage).toBe('data:image/png;base64,split');
  });

  it('replace import carries over frame images by matching shot number', () => {
    const existing = [
      createStoryboardTableRow(
        {
          shotNo: '131',
          frameImage: 'data:image/png;base64,split',
        },
        0
      ),
    ];
    const incoming = parseStoryboardBulkText(
      `镜号 | 画面
131 | 新描述`,
      'pipe'
    );
    const { rows } = applyStoryboardBulkImport([], existing, incoming.rows, 'replace');
    expect(rows[0]?.frameImage).toBe('data:image/png;base64,split');
  });
});
