import { describe, expect, it } from 'vitest';
import { buildPlainDayReceiptSummary, humanizeDevLogBullet } from '../services/devLogPlainSummary';

describe('devLogPlainSummary', () => {
  it('turns English commit-ish lines into Chinese feel copy', () => {
    expect(humanizeDevLogBullet('richer thermal receipt and work-style summaries')).toContain('小票');
    expect(humanizeDevLogBullet('feat: compose-style dropdowns and R2-backed dev log')).toMatch(/下拉|开发日志/);
    expect(humanizeDevLogBullet('feat: ship Project Agent U4 with experts and optimistic send')).toMatch(
      /@专家|自动挡|进度卡|立刻有反馈/
    );
  });

  it('does not collapse unknown English work into vague UI copy', () => {
    const plain = humanizeDevLogBullet('Expand AI Gateway workers and provider key pool');
    expect(plain).not.toBe('界面与使用体验有一处改进');
    expect(plain).toMatch(/AI Gateway|Key|worker|任务链路/);
  });

  it('builds day summary without file-count noise or long English', () => {
    const bullets = buildPlainDayReceiptSummary([
      'richer thermal receipt and work-style summaries',
      '共触及 6 个文件（+541 / −107）',
      '下拉视觉统一为全局输入框族（compose chip / settings 分轨）',
      '开发日志：push 后总结上传 R2，时间轴与小票导出',
    ]);
    expect(bullets.some((b) => /共触及|个文件（\+/.test(b))).toBe(false);
    expect(bullets.every((b) => (b.replace(/[^A-Za-z]/g, '').length || 0) / Math.max(b.length, 1) < 0.35)).toBe(
      true
    );
    expect(bullets[0]).toMatch(/小票|白话|好看/);
  });
});
