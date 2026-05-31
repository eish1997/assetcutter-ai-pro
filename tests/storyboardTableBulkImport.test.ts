import { describe, expect, it } from 'vitest';
import {
  applyStoryboardBulkImport,
  detectStoryboardBulkDelimiter,
  parseStoryboardBulkText,
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
});
