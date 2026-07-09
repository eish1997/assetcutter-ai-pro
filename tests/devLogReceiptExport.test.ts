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
  summaryBullets: ['下拉菜单外观和底部输入栏统一了', '左侧功能区小按钮更好认了'],
  commits: [{ sha: 'bbbbbbbb', subject: 'style: unify dropdown chips' }],
  stats: { filesChanged: 14, insertions: 100, deletions: 40 },
};

describe('devLog receipt', () => {
  it('builds plain day summary without duplicates', () => {
    const bullets = buildDayReceiptSummary([sample, { ...sample, id: 'x2' }]);
    expect(bullets[0]).toContain('下拉');
    expect(bullets.filter((b) => b.includes('下拉')).length).toBe(1);
  });

  it('renders thermal-like text receipt', () => {
    const text = buildDevLogReceiptText('2026-07-09', [sample]);
    expect(text).toContain('AssetCutter · DEV LOG');
    expect(text).toContain('日 结 小 票');
    expect(text).toContain('笔数');
    expect(text).toContain('aaaaaaa');
    expect(text).toContain('NO.');
    expect(text).toContain('【本日总结】');
  });
});
