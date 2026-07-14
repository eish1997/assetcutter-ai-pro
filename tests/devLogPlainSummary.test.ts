import { describe, expect, it } from 'vitest';
import { buildPlainDayReceiptSummary, humanizeDevLogBullet } from '../services/devLogPlainSummary';

describe('devLogPlainSummary', () => {
  it('turns platform commit-ish lines into Chinese product copy', () => {
    expect(humanizeDevLogBullet('feat: compose-style dropdowns and R2-backed dev log')).toMatch(/下拉菜单/);
    expect(humanizeDevLogBullet('feat: ship Project Agent U4 with experts and optimistic send')).toMatch(
      /@专家|自动挡|进度卡|反馈/
    );
    expect(humanizeDevLogBullet('Expand AI Gateway workers and provider key pool')).toMatch(
      /AI Gateway|Key|多模态|任务链路/
    );
  });

  it('drops internal dev-log, docs, and hook notes', () => {
    expect(humanizeDevLogBullet('richer thermal receipt and work-style summaries')).toBe('');
    expect(humanizeDevLogBullet('dev log post-push hook and handoff docs')).toBe('');
    expect(humanizeDevLogBullet('后台能读到开发日志记录了')).toBe('');
    expect(humanizeDevLogBullet('内部交接说明也跟着更新了')).toBe('');
  });

  it('builds day summary without hard-filled internal bullets', () => {
    const bullets = buildPlainDayReceiptSummary([
      'Expand AI Gateway workers and provider key pool',
      '开发日志小票更好看了，本日总结也更白话',
      '后台能读到开发日志记录了',
      '内部交接说明也跟着更新了',
    ]);
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toMatch(/AI Gateway|多模态|任务链路/);
  });

  it('does not include file-count noise or long English', () => {
    const bullets = buildPlainDayReceiptSummary([
      '共触发 6 个文件（+541 / -207）',
      '下拉视觉统一为全局输入框族',
    ]);
    expect(bullets.some((b) => /共触发|文件/.test(b))).toBe(false);
    expect(bullets.every((b) => (b.replace(/[^A-Za-z]/g, '').length || 0) / Math.max(b.length, 1) < 0.35)).toBe(
      true
    );
  });
});
