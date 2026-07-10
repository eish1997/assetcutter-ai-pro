import { describe, expect, it } from 'vitest';
import {
  COMPOSER_BUSY_HINT,
  COMPOSER_EMPTY_DRAFT_REASON,
  resolveComposerSubmitDisabledReason,
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
