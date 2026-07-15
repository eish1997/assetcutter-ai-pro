import { beforeEach, describe, expect, it, vi } from 'vitest';

const workflowChatMock = vi.hoisted(() => vi.fn());

vi.mock('../services/storyboardGatewayText', () => ({
  runStoryboardGatewayText: workflowChatMock,
}));

import {
  normalizeBulkAiNormalizeOutput,
  normalizeStoryboardBulkWithAi,
  parseStoryboardBulkTextWithAiFallback,
} from '../services/storyboardTableBulkAiDetect';
import { getBuiltinStoryboardParsePreset } from '../services/storyboardTableParse';

describe('storyboardTableBulkAiDetect', () => {
  beforeEach(() => {
    workflowChatMock.mockReset();
  });

  it('normalizeBulkAiNormalizeOutput parses JSON payload', () => {
    const out = normalizeBulkAiNormalizeOutput(
      JSON.stringify({
        isStoryboard: true,
        normalizedText: '镜头号 | 景别\nA01 | 远景',
      })
    );
    expect(out.isStoryboard).toBe(true);
    expect(out.normalizedText).toContain('A01');
  });

  it('normalizeStoryboardBulkWithAi rejects non-storyboard text', async () => {
    workflowChatMock.mockResolvedValueOnce(
      JSON.stringify({
        isStoryboard: false,
        reason: '这是普通聊天内容',
      })
    );

    const result = await normalizeStoryboardBulkWithAi(
      '你好，今天天气不错',
      getBuiltinStoryboardParsePreset(),
      {}
    );
    expect(result.isStoryboard).toBe(false);
    if (result.isStoryboard === false) {
      expect(result.reason).toContain('聊天');
    }
  });

  it('normalizeStoryboardBulkWithAi returns normalized pipe table', async () => {
    workflowChatMock.mockResolvedValueOnce(
      JSON.stringify({
        isStoryboard: true,
        normalizedText: `音效 | 时长 | 画面内容
-10dB (窗外低频) | 24帧 | 城市夜景`,
      })
    );

    const result = await normalizeStoryboardBulkWithAi(
      '镜1：窗外低频 -10dB，24帧，城市夜景',
      getBuiltinStoryboardParsePreset(),
      {}
    );
    expect(result.isStoryboard).toBe(true);
    if (result.isStoryboard) {
      expect(result.normalizedText).toContain('|');
      expect(result.parsed.rows.length).toBeGreaterThan(0);
      expect(result.parsed.rows[0]?.durationSec).toBe(1);
    }
  });

  it('parseStoryboardBulkTextWithAiFallback uses local parse when possible', async () => {
    const text = `镜头号 | 景别 | 时长
A01 | 远景 | 2s`;
    const result = await parseStoryboardBulkTextWithAiFallback(
      text,
      'pipe',
      getBuiltinStoryboardParsePreset(),
      {}
    );
    expect(result.source).toBe('local');
    expect(result.rows).toHaveLength(1);
    expect(workflowChatMock).not.toHaveBeenCalled();
  });

  it('parseStoryboardBulkTextWithAiFallback calls AI when local parse empty', async () => {
    workflowChatMock.mockResolvedValueOnce(
      JSON.stringify({
        isStoryboard: true,
        normalizedText: `画面内容 | 音效
办公室内景 | 空调低频`,
      })
    );

    const result = await parseStoryboardBulkTextWithAiFallback(
      '- | -',
      'pipe',
      getBuiltinStoryboardParsePreset(),
      {}
    );
    expect(result.source).toBe('ai');
    if (result.source !== 'ai') throw new Error('expected AI fallback result');
    expect(result.rows).toHaveLength(1);
    expect(result.normalizedText).toContain('办公室内景');
  });
});
