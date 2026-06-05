import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../services/workflowAuditEvents.js', () => ({
  appendWorkflowAuditEvent: vi.fn(),
}));

import { appendWorkflowAuditEvent } from '../services/workflowAuditEvents.js';
import {
  auditStoryboardTaskOutcome,
  resolveStoryboardCollageAuditOperation,
  runStoryboardLlmAudited,
} from '../services/storyboardTaskAuditEvents.js';

describe('resolveStoryboardCollageAuditOperation', () => {
  it('prefers explicit auditOperation', () => {
    expect(
      resolveStoryboardCollageAuditOperation({
        auditOperation: 'row_redraw',
        feedbackRedraw: true,
        rowCount: 3,
      })
    ).toBe('row_redraw');
  });

  it('marks feedback redraw for batch collage', () => {
    expect(resolveStoryboardCollageAuditOperation({ feedbackRedraw: true, rowCount: 1 })).toBe(
      'feedback_redraw'
    );
    expect(resolveStoryboardCollageAuditOperation({ rowCount: 2 })).toBe('feedback_redraw');
  });

  it('marks single collage as collage_redraw by default', () => {
    expect(resolveStoryboardCollageAuditOperation({ rowCount: 1 })).toBe('collage_redraw');
  });
});

describe('storyboard task audit', () => {
  beforeEach(() => {
    vi.mocked(appendWorkflowAuditEvent).mockReset();
  });

  it('skips audit when assetId missing', () => {
    auditStoryboardTaskOutcome({
      kind: 'gen',
      ok: true,
      assetId: '',
      operation: 'sheet_gen',
      message: 'test',
    });
    expect(appendWorkflowAuditEvent).not.toHaveBeenCalled();
  });

  it('records STORYBOARD_GEN_SUCCESS', () => {
    auditStoryboardTaskOutcome({
      kind: 'gen',
      ok: true,
      assetId: 'table-1',
      operation: 'sheet_gen',
      message: '分镜表 · 任务 1 生图完成',
      detail: { chunkIndex: 0 },
    });
    expect(appendWorkflowAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'STORYBOARD_GEN_SUCCESS',
        assetId: 'table-1',
        detail: expect.objectContaining({ operation: 'sheet_gen', context: 'storyboard_table' }),
      })
    );
  });

  it('runStoryboardLlmAudited records failure then rethrows', async () => {
    await expect(
      runStoryboardLlmAudited(
        { storyboardAssetId: 'table-1' },
        'parse_text',
        async () => {
          throw new Error('boom');
        },
        { success: () => 'ok' }
      )
    ).rejects.toThrow('boom');

    expect(appendWorkflowAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'STORYBOARD_LLM_FAILED',
        level: 'error',
      })
    );
  });
});
