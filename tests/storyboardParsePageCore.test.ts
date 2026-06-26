import { describe, expect, it, vi } from 'vitest';

const workflowChatMock = vi.hoisted(() => vi.fn());

vi.mock('../services/unifiedAiGateway', () => ({
  workflowChat: workflowChatMock,
}));

import {
  buildBulkImportRowsForParsePageWrite,
  buildConfirmedParsePageFieldLabels,
  compactParsePageDynamicLabel,
  detectStoryboardShotTextBlocks,
  extractBroadShotNoFromLine,
  convertStoryboardParsePageFormatWithLlm,
  DEFAULT_STORYBOARD_PARSE_PAGE_FORMAT_INSTRUCTION,
  generateCanonicalStoryboardBulkText,
  isParsePagePlaceholderFieldLabel,
  llmBulkOutputToParsePageResult,
  mapHeaderLabelToFixedField,
  parseFieldsFromStoryboardText,
  parseStoryboardRawShotsFromText,
  renameParsePageDynamicFieldLabel,
  STORYBOARD_PARSE_PAGE_CANONICAL_HEADER,
  STORYBOARD_PARSE_PAGE_FORMAT_MODEL_ID,
  STORYBOARD_PARSE_PAGE_NO_SHOT_HINT,
} from '../services/storyboardParsePageCore';
import { STORYBOARD_BULK_LLM_TIMEOUT_MS } from '../services/storyboardTableBulkAiDetect';

describe('storyboardParsePageCore', () => {
  it('detects broad shot numbers from mixed lines', () => {
    expect(extractBroadShotNoFromLine('SC01_SH001 | 大远景 | 3.0s | 城市夜景')).toBe('SC01_SH001');
    expect(extractBroadShotNoFromLine('镜号：041 中景 推镜')).toBe('041');
    expect(extractBroadShotNoFromLine('A01 远景')).toBe('A01');
    expect(extractBroadShotNoFromLine('3.0s | 城市')).toBe('');
  });

  it('rejects text without shot anchors', () => {
    const result = parseFieldsFromStoryboardText('这是一段没有镜号的说明文字');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(STORYBOARD_PARSE_PAGE_NO_SHOT_HINT);
  });

  it('parses field labels from pipe table sample', () => {
    const text = `镜头号 | 景别 | 时长 | 画面 | 对白
001 | 远景 | 2.5s | 城市夜景 | 无
002 | 中景 | 1.5s | 办公室 | 你好`;
    const result = parseFieldsFromStoryboardText(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shotBlocks).toHaveLength(2);
    expect(result.detectedFixedLabels).toEqual(
      expect.arrayContaining(['镜头号', '景别', '时长', '画面', '对白'])
    );
  });

  it('generates canonical pipe text with confirmed labels', () => {
    const text = `镜头号 | 景别 | 时长 | 画面
001 | 远景 | 2s | 城市
002 | 中景 | 1s | 室内`;
    const parsed = parseFieldsFromStoryboardText(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const labels = buildConfirmedParsePageFieldLabels(parsed.dynamicLabels, new Set(), new Set());
    const canonical = generateCanonicalStoryboardBulkText(parsed.importRows, labels);
    expect(canonical.startsWith(STORYBOARD_PARSE_PAGE_CANONICAL_HEADER)).toBe(true);
    expect(canonical.split('\n')).toHaveLength(3);
  });

  it('maps long canonical headers to fixed fields and compacts remaining dynamic labels', () => {
    expect(mapHeaderLabelToFixedField('画面描述、角色表演与3D流体特效（直接喂给AI）')).toBe('画面');
    expect(mapHeaderLabelToFixedField('3D虚拟机位运镜与构图描述')).toBe('运镜');
    expect(compactParsePageDynamicLabel('镜头内角色')).toBe('角色');

    const text = `镜号 | 画面描述、角色表演与3D流体特效（直接喂给AI） | 3D虚拟机位运镜与构图描述 | 音效
131 | 杀气复苏 | 【对角线切入】相机跟随 | 风声
132 | 新画面 | 平移 | -`;
    const result = parseFieldsFromStoryboardText(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detectedFixedLabels).toEqual(
      expect.arrayContaining(['画面', '运镜', '备注'])
    );
    expect(result.dynamicLabels).toEqual([]);
  });

  it('splits blocks for numbered script lines', () => {
    const text = `001 远景 2s 城市夜景
002 中景 1.5s 办公室内景`;
    const blocks = detectStoryboardShotTextBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.shotNo).toBe('001');
    expect(blocks[1]?.shotNo).toBe('002');
  });

  it('parseStoryboardRawShotsFromText keeps whole block as shotRaw with only shotNo and duration', () => {
    const text = `113 | 3.0s | 特写 | - | 【画面描述】强压怒火 | 【空间抽离变焦】相机直盯广济 | 对白 | -
114 | 2s | 近景 | 内容`;
    const result = parseStoryboardRawShotsFromText(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.importRows).toHaveLength(2);
    expect(result.importRows[0]?.shotNo).toBe('113');
    expect(result.importRows[0]?.durationSec).toBe(3);
    expect(result.importRows[0]?.fields).toEqual([]);
    expect(result.importRows[0]?.shotRaw).toContain('【画面描述】强压怒火');
    expect(result.importRows[1]?.durationSec).toBe(2);
  });

  it('parseStoryboardRawShotsFromText skips blocks missing duration', () => {
    const text = `001 远景 2s 城市
002 中景 办公室`;
    const result = parseStoryboardRawShotsFromText(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.importRows).toHaveLength(1);
    expect(result.skippedMissingDuration).toBe(1);
    expect(result.previews[1]?.ready).toBe(false);
  });

  it('generates canonical text from freeform tagged script lines', () => {
    const text = `001 大远景 4.5s 【z轴垂直缓推】 【画面描述】南荒密林。惨白月光
002 近景 3.0s 【缓慢视差平移】 【画面描述】林七夜侧脸`;
    const parsed = parseFieldsFromStoryboardText(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.detectedFixedLabels).toEqual(
      expect.arrayContaining(['时长', '景别', '画面', '运镜'])
    );
    const labels = buildConfirmedParsePageFieldLabels(parsed.dynamicLabels, new Set(), new Set());
    const canonical = generateCanonicalStoryboardBulkText(parsed.importRows, labels);
    const row1 = canonical.split('\n')[1] ?? '';
    expect(row1).toContain('001');
    expect(row1).toContain('4.5s');
    expect(row1).toContain('大远景');
    expect(row1).toContain('南荒密林');
    expect(row1).toMatch(/z轴垂直缓推|【z轴垂直缓推】/);
  });

  it('llmBulkOutputToParsePageResult maps rows to parse page fields', () => {
    const result = llmBulkOutputToParsePageResult(
      {
        rows: [
          {
            shotNo: '049',
            fields: [
              { label: '时长', value: '1.5s' },
              { label: '景别', value: '近景' },
              { label: '画面', value: '叶不凡抬臂迎击' },
              { label: '运镜', value: '强广角' },
              { label: '对白', value: '无' },
            ],
          },
        ],
      },
      '049 近景 1.5s'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.importRows[0]?.shotNo).toBe('049');
    expect(result.importRows[0]?.durationSec).toBe(1.5);
    expect(result.detectedFixedLabels).toEqual(
      expect.arrayContaining(['时长', '景别', '画面', '运镜', '对白'])
    );
    const labels = buildConfirmedParsePageFieldLabels(result.dynamicLabels, new Set(), new Set());
    const canonical = generateCanonicalStoryboardBulkText(result.importRows, labels);
    expect(canonical).toContain('049');
    expect(canonical).toContain('1.5s');
    expect(canonical).toContain('近景');
    expect(canonical).toContain('叶不凡抬臂迎击');
    expect(canonical).toContain('强广角');
  });

  it('buildBulkImportRowsForParsePageWrite matches canonical preview columns', () => {
    const llm = llmBulkOutputToParsePageResult(
      {
        rows: [
          {
            shotNo: '049',
            fields: [
              { label: '时长', value: '1.5s' },
              { label: '景别', value: '近景' },
              { label: '画面', value: '叶不凡抬臂' },
              { label: '运镜', value: '强广角' },
              { label: '对白', value: '无' },
            ],
          },
        ],
      },
      'src'
    );
    if (!llm.ok) throw new Error('expected ok');
    const labels = buildConfirmedParsePageFieldLabels(llm.dynamicLabels, new Set(), new Set());
    const canonical = generateCanonicalStoryboardBulkText(llm.importRows, labels);
    const importRows = buildBulkImportRowsForParsePageWrite(llm, labels, canonical);
    expect(importRows[0]?.fields.find((f) => f.label === '画面')?.value).toBe('叶不凡抬臂');
    expect(importRows[0]?.fields.find((f) => f.label === '运镜')?.value).toBe('强广角');
    expect(importRows[0]?.shotRaw).toBe(canonical.split('\n')[1]);
  });

  it('convertStoryboardParsePageFormatWithLlm sends whole text in one LLM call with fixed header', async () => {
    workflowChatMock.mockResolvedValueOnce(
      JSON.stringify({
        isStoryboard: true,
        normalizedText: `${STORYBOARD_PARSE_PAGE_CANONICAL_HEADER}\n001 | 2s | 远景 | - | 城市 | - | - | -`,
      })
    );

    const preset = {
      id: 'storyboard_parse_default',
      label: '分镜结构化解析',
      category: 'text_to_text' as const,
      instruction: 'ignored',
    };
    const result = await convertStoryboardParsePageFormatWithLlm(
      '001 远景 2s 城市',
      preset,
      {}
    );

    expect(workflowChatMock).toHaveBeenCalledTimes(1);
    const body = workflowChatMock.mock.calls[0]?.[0]?.[0]?.parts?.[0]?.text ?? '';
    const modelArg = workflowChatMock.mock.calls[0]?.[1];
    const optionsArg = workflowChatMock.mock.calls[0]?.[2];
    expect(body).toContain('001 远景 2s 城市');
    expect(body).toContain(STORYBOARD_PARSE_PAGE_CANONICAL_HEADER);
    expect(body).toContain(DEFAULT_STORYBOARD_PARSE_PAGE_FORMAT_INSTRUCTION.slice(0, 20));
    expect(body).not.toContain('ignored');
    expect(modelArg).toBe(STORYBOARD_PARSE_PAGE_FORMAT_MODEL_ID);
    expect(optionsArg?.timeoutMs).toBe(STORYBOARD_BULK_LLM_TIMEOUT_MS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowCount).toBe(1);
    expect(result.normalizedText).toContain('001');
    workflowChatMock.mockReset();
  });

  it('enriches placeholder column hints and supports rename', () => {
    const text = `001 | 风声 | 独特内容A | 远景
002 | 环境音 | 独特内容B | 中景`;
    const parsed = parseFieldsFromStoryboardText(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const placeholder = parsed.dynamicLabels.find(isParsePagePlaceholderFieldLabel);
    expect(placeholder).toBeTruthy();
    expect(parsed.dynamicLabelHints[placeholder!]).toMatch(/未识别表头 · 样例：/);

    const renamed = renameParsePageDynamicFieldLabel(parsed, placeholder!, '氛围');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.result.dynamicLabels).toContain('氛围');
    expect(renamed.result.importRows[0]?.fields.some((f) => f.label === '氛围')).toBe(true);
  });
});
