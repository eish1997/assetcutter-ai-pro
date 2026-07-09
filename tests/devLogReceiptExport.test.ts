import { describe, expect, it } from 'vitest';
import { buildDevLogReceiptText } from '../services/devLogReceiptExport';
import { buildDayReceiptSummary } from '../services/devLogClient';
import type { DevLogEntry } from '../types/devLog';

const sample: DevLogEntry = {
  id: '20260709-120000-abc1234',
  dayKey: '2026-07-09',
  pushedAt: '2026-07-09T12:00:00.000Z',
  fromSha: 'aaaaaaaa',
  toSha: 'bbbbbbbb',
  summaryBullets: ['UI 下拉：对齐全局输入框', '功能区组头改 pill'],
  commits: [{ sha: 'bbbbbbbb', subject: 'style: unify dropdown chips' }],
  stats: { filesChanged: 14, insertions: 100, deletions: 40 },
};

describe('devLog receipt', () => {
  it('builds day summary without duplicates', () => {
    const bullets = buildDayReceiptSummary([sample, { ...sample, id: 'x2' }]);
    expect(bullets[0]).toContain('UI 下拉');
    expect(bullets.filter((b) => b.includes('UI 下拉')).length).toBe(1);
  });

  it('renders thermal-like text receipt', () => {
    const text = buildDevLogReceiptText('2026-07-09', [sample]);
    expect(text).toContain('AssetCutter · DEV LOG');
    expect(text).toContain('日结小票');
    expect(text).toContain('笔数');
    expect(text).toContain('aaaaaaa');
  });
});
