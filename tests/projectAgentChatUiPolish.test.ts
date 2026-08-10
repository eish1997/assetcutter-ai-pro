import { describe, expect, it } from 'vitest';
import {
  COMPOSER_BUSY_HINT,
  COMPOSER_EMPTY_DRAFT_REASON,
  FAILURE_RECOVERY_RETRY_ACTION,
  quickComposeChatActionConfirmSummary,
  quickComposeChatActionConfirmCopy,
  quickComposeChatActionNeedsConfirm,
  resolveComposerSubmitDisabledReason,
  resolveFailureRecoveryAction,
  shouldHardBlockComposerCredits,
} from '../components/workflow/quickComposeChat/chatUiCopy';
import { parseInlineMarkdown, parseSafeMarkdown } from '../components/workflow/quickComposeChat/safeMarkdown';

describe('resolveComposerSubmitDisabledReason (P0.5-a)', () => {
  it('prioritizes busy over credits and empty draft', () => {
    expect(
      resolveComposerSubmitDisabledReason({
        threadBusy: true,
        creditsBlocked: true,
        creditsReason: '积分不足',
        draftEmpty: true,
      })
    ).toBe(COMPOSER_BUSY_HINT);
  });

  it('uses credits reason when not busy', () => {
    expect(
      resolveComposerSubmitDisabledReason({
        threadBusy: false,
        creditsBlocked: true,
        creditsReason: '请先登录',
        draftEmpty: true,
      })
    ).toBe('请先登录');
  });

  it('uses empty draft when only draft is empty', () => {
    expect(
      resolveComposerSubmitDisabledReason({
        threadBusy: false,
        creditsBlocked: false,
        draftEmpty: true,
      })
    ).toBe(COMPOSER_EMPTY_DRAFT_REASON);
  });

  it('returns undefined when send is allowed', () => {
    expect(
      resolveComposerSubmitDisabledReason({
        threadBusy: false,
        creditsBlocked: false,
        draftEmpty: false,
      })
    ).toBeUndefined();
  });
});

describe('shouldHardBlockComposerCredits', () => {
  it('keeps login and known insufficient balance as hard blocks', () => {
    expect(
      shouldHardBlockComposerCredits({
        creditsBlocked: true,
        creditsBypass: false,
        userId: null,
        balance: null,
        balanceLoading: false,
      })
    ).toBe(true);

    expect(
      shouldHardBlockComposerCredits({
        creditsBlocked: true,
        creditsBypass: false,
        userId: 'u1',
        balance: 0,
        balanceLoading: false,
      })
    ).toBe(true);
  });

  it('does not hard-block Agent chat when local balance service is unavailable', () => {
    expect(
      shouldHardBlockComposerCredits({
        creditsBlocked: true,
        creditsBypass: false,
        userId: 'u1',
        balance: null,
        balanceLoading: false,
      })
    ).toBe(false);
  });
});

describe('quick compose action fallback copy (Phase 1)', () => {
  it('gives failed messages a recovery action', () => {
    expect(resolveFailureRecoveryAction({ status: 'error', errorMessage: 'timeout' })).toEqual(
      FAILURE_RECOVERY_RETRY_ACTION
    );
    expect(resolveFailureRecoveryAction({ status: 'done' })).toBeUndefined();
  });

  it('requires confirmation for cost and destructive actions', () => {
    expect(quickComposeChatActionNeedsConfirm({ kind: 'generate', requiresCost: true })).toBe(true);
    expect(quickComposeChatActionConfirmCopy({ kind: 'generate', costCredits: 1 })).toContain('约 1 积分');

    expect(quickComposeChatActionNeedsConfirm({ kind: 'delete_asset', destructive: true })).toBe(true);
    expect(quickComposeChatActionConfirmCopy({ kind: 'delete_asset', destructive: true })).toContain('修改、覆盖或删除');

    expect(
      quickComposeChatActionConfirmCopy({
        kind: 'save_memory',
        requiresConfirmation: true,
      })
    ).toContain('偏好或资产规则');

    expect(quickComposeChatActionConfirmCopy({ kind: 'save_preset', requiresConfirmation: true })).toBe(
      [
        '准备执行：',
        '范围：当前对话上下文',
        '影响：会按当前上下文执行这个动作',
        '预计：不预计消耗积分',
        '可恢复：可在后续管理入口调整或移除',
      ].join('\n')
    );
  });

  it('builds commercial confirmation summary with scope, impact, cost and recoverability', () => {
    expect(
      quickComposeChatActionConfirmSummary({
        kind: 'apply',
        confirmLevel: 'cost',
        riskLevel: 'medium',
        targetScope: 'selected',
        estimatedItems: 3,
        confirmation: {
          impact: '会创建新版本，不覆盖原内容',
          cost: '约 12 积分',
          recoverability: '保留原资产',
        },
      })
    ).toBe(
      [
        '准备执行：',
        '范围：当前选中 3 个资产',
        '影响：会创建新版本，不覆盖原内容',
        '预计：约 12 积分',
        '可恢复：保留原资产',
      ].join('\n')
    );
  });

  it('includes runtime perception in action confirmation copy', () => {
    expect(
      quickComposeChatActionConfirmSummary({
        kind: 'apply',
        confirmLevel: 'cost',
        perception: {
          visibleSummary: 'Project: Launch | Selected 5 assets | Maya: disconnected',
          targetSummary: 'Project: Launch | Surface: canvas | Selected 5 assets',
          workflowSummary: 'Plan: maya-export | 1/2 steps done',
          externalSummary: 'Maya: disconnected | selection unknown',
          riskSummary: 'Maya is not connected',
          stale: true,
        },
      })
    ).toBe(
      [
        '准备执行：',
        '范围：Project: Launch | Surface: canvas | Selected 5 assets',
        '影响：会执行一次付费或批量处理动作',
        '预计：以执行时实际计费为准',
        '可恢复：默认保留原资产，失败后保留可恢复状态',
        'Workflow：Plan: maya-export | 1/2 steps done',
        '外部：Maya: disconnected | selection unknown',
        '风险：Maya is not connected',
        '新鲜度：上下文可能已过期，执行前需要重新确认范围',
      ].join('\n')
    );
  });

  it('does not require confirmation for ordinary reply and open_panel actions', () => {
    expect(quickComposeChatActionNeedsConfirm({ kind: 'reply' })).toBe(false);
    expect(quickComposeChatActionConfirmCopy({ kind: 'reply' })).toBeUndefined();
    expect(quickComposeChatActionNeedsConfirm({ kind: 'open_panel' })).toBe(false);
  });
});

describe('parseSafeMarkdown (P0.5-b)', () => {
  it('parses fenced code, list, and bold', () => {
    const blocks = parseSafeMarkdown('前言\n\n```ts\nconst x = 1\n```\n\n- a\n- **b**\n');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'code', 'ul']);
    const ul = blocks[2];
    expect(ul?.type).toBe('ul');
    if (ul?.type === 'ul') {
      expect(ul.items[1]?.some((n) => n.type === 'strong')).toBe(true);
    }
    const code = blocks[1];
    expect(code?.type).toBe('code');
    if (code?.type === 'code') {
      expect(code.lang).toBe('ts');
      expect(code.text).toBe('const x = 1');
    }
  });

  it('rejects javascript: links', () => {
    const nodes = parseInlineMarkdown('[x](javascript:alert(1))');
    expect(nodes.some((n) => n.type === 'link')).toBe(false);
    expect(nodes.map((n) => (n.type === 'text' ? n.text : '')).join('')).toContain('javascript:');
  });

  it('accepts https links', () => {
    const nodes = parseInlineMarkdown('[docs](https://example.com/a)');
    expect(nodes).toEqual([
      { type: 'link', href: 'https://example.com/a', children: [{ type: 'text', text: 'docs' }] },
    ]);
  });

  it('does not interpret raw HTML as markup', () => {
    const blocks = parseSafeMarkdown('<script>alert(1)</script>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('paragraph');
    if (blocks[0]?.type === 'paragraph') {
      const text = blocks[0].children
        .map((n) => (n.type === 'text' ? n.text : ''))
        .join('');
      expect(text).toContain('<script>');
    }
  });
});
