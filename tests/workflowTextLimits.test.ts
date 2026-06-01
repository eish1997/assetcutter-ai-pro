import { describe, expect, it } from 'vitest';

import {
  WORKFLOW_TEXT_CONFIRM_CHARS,
  WORKFLOW_TEXT_PRE_IMAGE_UNDERSTAND_MAX_CHARS,
  WORKFLOW_TEXT_SEND_MAX_CHARS,
  WORKFLOW_TEXT_SEND_MAX_CHARS_GEMINI,
  WORKFLOW_TEXT_VISION_SEND_MAX_CHARS,
  clampWorkflowTextForSend,
  resolveWorkflowTextSendLimit,
  workflowTextLengthTier,
} from '../services/workflowTextLimits';

describe('resolveWorkflowTextSendLimit', () => {
  it('GPT 文生文使用较紧上限', () => {
    expect(resolveWorkflowTextSendLimit('text_to_text', { modelFamily: 'openai' })).toBe(
      WORKFLOW_TEXT_SEND_MAX_CHARS
    );
  });

  it('Gemini 文生文可放宽', () => {
    expect(resolveWorkflowTextSendLimit('text_to_text', { modelFamily: 'gemini' })).toBe(
      WORKFLOW_TEXT_SEND_MAX_CHARS_GEMINI
    );
  });

  it('多图时缩小图生文预算', () => {
    const base = resolveWorkflowTextSendLimit('image_to_text', { modelFamily: 'gemini', referenceImageCount: 0 });
    const heavy = resolveWorkflowTextSendLimit('image_to_text', {
      modelFamily: 'gemini',
      referenceImageCount: 5,
    });
    expect(base).toBe(WORKFLOW_TEXT_VISION_SEND_MAX_CHARS);
    expect(heavy).toBeLessThan(base);
  });

  it('生图理解前用户段上限为官方 32k 的 90%', () => {
    expect(WORKFLOW_TEXT_PRE_IMAGE_UNDERSTAND_MAX_CHARS).toBe(28_800);
    expect(resolveWorkflowTextSendLimit('pre_image_understand', { modelFamily: 'gemini' })).toBe(
      WORKFLOW_TEXT_PRE_IMAGE_UNDERSTAND_MAX_CHARS
    );
  });
});

describe('clampWorkflowTextForSend', () => {
  it('保留末尾并标记截断', () => {
    const raw = `HEAD_${'x'.repeat(100)}_TAIL`;
    const { text, truncated, originalLength } = clampWorkflowTextForSend(raw, 40);
    expect(truncated).toBe(true);
    expect(originalLength).toBe(raw.length);
    expect(text.endsWith('_TAIL')).toBe(true);
    expect(text.includes('前文已截断')).toBe(true);
  });
});

describe('workflowTextLengthTier', () => {
  it('分级阈值', () => {
    expect(workflowTextLengthTier(100)).toBe('ok');
    expect(workflowTextLengthTier(WORKFLOW_TEXT_CONFIRM_CHARS - 1)).toBe('warn');
    expect(workflowTextLengthTier(WORKFLOW_TEXT_CONFIRM_CHARS)).toBe('confirm');
  });
});
